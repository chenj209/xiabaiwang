@echo off
echo Generating SSL certificates for HTTPS support...

REM Create SSL directory if it doesn't exist
if not exist "backend\ssl" mkdir backend\ssl

REM Generate private key
openssl genrsa -out backend\ssl\server.key 2048

REM Generate certificate signing request
openssl req -new -key backend\ssl\server.key -out backend\ssl\server.csr -subj "/C=US/ST=State/L=City/O=Organization/CN=8.148.30.163"

REM Generate self-signed certificate
openssl x509 -req -in backend\ssl\server.csr -signkey backend\ssl\server.key -out backend\ssl\server.crt -days 365

REM Remove the CSR file as it's no longer needed
del backend\ssl\server.csr

echo.
echo SSL certificates generated successfully!
echo - Private key: backend\ssl\server.key
echo - Certificate: backend\ssl\server.crt
echo.
echo Note: These are self-signed certificates. Browsers will show a security warning.
echo For production, use certificates from a trusted CA.
echo.
pause 