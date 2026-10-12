import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const configPath=resolve('tsconfig.server.json');
const config=ts.readConfigFile(configPath,ts.sys.readFile);
if(config.error)throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText,'\n'));
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,process.cwd());
for(const key of ['strict','allowJs','checkJs','noEmit'])if(parsed.options[key]!==true)throw Error(`Server typing requires ${key}`);
if(parsed.options.skipLibCheck!==false)throw Error('Server contracts must also be checked');
const roots=new Set(parsed.fileNames.map(file=>resolve(file)));
const files=readdirSync('server',{recursive:true}).filter(file=>typeof file==='string' && /\.(mjs|mts|ts)$/.test(file) && !(/\.test\.[cm]?ts$|\.test\.mjs$/.test(file)) && !file.startsWith('generated') && !file.startsWith('type-tests'));
for(const file of files) {
  const path=resolve('server',file),source=readFileSync(path,'utf8');
  if(!roots.has(path))throw Error(`Production module is not typechecked: ${file}`);
  if(/@ts-(?:nocheck|ignore|expect-error)|@type\s*\{\s*any\b|@param\s*\{\s*any\b/.test(source))throw Error(`Typing bypass in ${file}`);
}
// Verify request bodies as actually resolved by TypeScript, not just a text scan
// for annotations. Express's default any must not reach a body-reading handler.
const program=ts.createProgram(parsed.fileNames,parsed.options),checker=program.getTypeChecker();
const serverRoot=resolve('server')+sep;
for(const source of program.getSourceFiles()) {
  const path=resolve(source.fileName);
  if(!path.startsWith(serverRoot))continue;
  const local=path.slice(serverRoot.length);
  if(local.startsWith('generated'))continue;
  const visit=node=>{
    if(node.kind===ts.SyntaxKind.AnyKeyword)throw Error(`Explicit any in ${local}`);
    if(ts.isPropertyAccessExpression(node)&&node.name.text==='body'&&(checker.getTypeAtLocation(node).flags&ts.TypeFlags.Any))throw Error(`Untyped request body in ${local}:${source.getLineAndCharacterOfPosition(node.getStart()).line+1}`);
    ts.forEachChild(node,visit);
  };
  visit(source);
}
console.log(`Server type coverage: ${files.length} production modules/contracts; no untyped request body.`);
