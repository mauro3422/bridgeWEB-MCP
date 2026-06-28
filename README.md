# bridge-mcp

MCP local propio para conectar ChatGPT/Kairos/KChat con MauroPrime y, después, la laptop.

## Recomendación de arquitectura

Ruta principal:

```text
ChatGPT Developer Mode
  -> OpenAI Secure MCP Tunnel
  -> bridge-mcp en la PC
  -> filesystem / shell / git / procesos
```

Primero se implementa `stdio` porque es lo más simple para validar el servidor MCP local.
Después se agrega túnel oficial o transporte HTTP según convenga.

## Scripts

```powershell
npm install
npm run build
npm run start
```

## Tools iniciales

- `system_info`: datos básicos de la máquina.
- `list_dir`: lista una carpeta.
- `read_text_file`: lee texto con límite de tamaño.
- `write_text_file`: escribe texto.
- `run_command`: ejecuta comando con `cwd`, timeout y salida capturada.

## Nota

Este proyecto está pensado como reemplazo propio de Desktop Commander, no como dependencia final.
Desktop Commander queda sólo como puente temporal para construir esto.
