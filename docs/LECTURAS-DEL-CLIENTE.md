# Lecturas del cliente con aprobación

Cliente: Mi empresa → Cargar horómetros → Descargar plantilla de mi flota. Completar fecha (dd/mm/aaaa), hora de Guatemala, horómetro y observación opcional. Conservar la serie. El Excel admite una hoja Lecturas o Lecturas Distelsa, hasta 200 filas y 2 MB. Las filas de equipos sin fecha, hora ni lectura se omiten. No se admiten fórmulas ni fechas futuras.

Enviar a validación guarda registros separados de las lecturas oficiales. El cliente solo envía y consulta equipos de su empresa. Los reintentos con mismo equipo, instante y valor se omiten; valores diferentes para el mismo instante se rechazan. Los envíos rechazados se conservan y permiten presentar una corrección como nuevo registro.

Administración: Datos y respaldos → Validar horómetros del cliente → Revisar envíos. Cada aprobación o rechazo exige motivo. Aprobar crea una lectura oficial y enlaza su ID al envío, en una sola transacción con revisión de concurrencia. Un segundo intento de aprobación no crea otra lectura. Una lectura oficial ya existente en ese instante, un retroceso o un incremento superior a las horas transcurridas bloquea la aprobación: rechazar y revisar el contador mediante el flujo de corrección existente.

El técnico y el coordinador no pueden enviar ni aprobar estos lotes. Sus permisos operativos anteriores se conservan. Los envíos no se muestran a otros clientes. La bitácora conserva remitente, revisor, fechas y decisiones; cada registro conserva nombre de archivo, lote y los valores enviados. El archivo binario no se almacena: el cliente debe conservar su Excel original.

La colección LecturaEnviada se almacena en em_records y se incluye en respaldos. No requiere una tabla nueva ni modifica lecturas existentes. Los respaldos anteriores sin esta colección se interpretan con una colección vacía. Costos e inventario permanecen fuera del alcance.
