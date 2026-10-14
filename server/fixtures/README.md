# Video sintético de pruebas

`video-qa.mp4` es un patrón de prueba de 160 × 90, dos segundos, H.264 y audio AAC silencioso. No contiene datos de clientes ni grabaciones de personas.

Generado con FFmpeg 7.1 (`testsrc2=size=160x90:rate=10`, `anullsrc=r=44100:cl=mono`, `-t 2 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart`). FFmpeg solo se utilizó para producir esta muestra; no es una dependencia del portal.
