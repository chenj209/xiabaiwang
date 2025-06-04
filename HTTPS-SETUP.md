# HTTPS Setup Guide

This guide explains how to set up HTTPS support for your application to resolve mixed content errors when deploying on an SSH server.

## Problem

When your webpage is served over HTTPS, browsers block HTTP requests for security reasons. This causes "Mixed Content" errors like:

```
Mixed Content: The page at 'https://8.148.30.163/' was loaded over HTTPS, but requested an insecure XMLHttpRequest endpoint 'http://8.148.30.163:3001/socket.io/?EIO=4&transport=polling'. This request has been blocked; the content must be served over HTTPS.
```

## Solution

The backend now supports both HTTP and HTTPS servers:
- **HTTP**: Port 3001 (default)
- **HTTPS**: Port 3443 (default)

The frontend automatically detects the protocol and connects to the appropriate port.

## Setup Instructions

### 1. Generate SSL Certificates

#### For Linux/macOS:
```bash
chmod +x generate-ssl.sh
./generate-ssl.sh
```

#### For Windows:
```batch
generate-ssl.bat
```

#### Manual Generation:
```bash
# Create SSL directory
mkdir -p backend/ssl

# Generate private key
openssl genrsa -out backend/ssl/server.key 2048

# Generate certificate
openssl req -new -key backend/ssl/server.key -out backend/ssl/server.csr -subj "/C=US/ST=State/L=City/O=Organization/CN=8.148.30.163"
openssl x509 -req -in backend/ssl/server.csr -signkey backend/ssl/server.key -out backend/ssl/server.crt -days 365

# Clean up
rm backend/ssl/server.csr
```

### 2. Start the Server

```bash
cd backend
npm start
```

The server will now run on both:
- HTTP: `http://8.148.30.163:3001`
- HTTPS: `https://8.148.30.163:3443`

### 3. Access Your Application

- **HTTP**: `http://8.148.30.163:3001`
- **HTTPS**: `https://8.148.30.163:3443`

## Important Notes

### Self-Signed Certificates

The generated certificates are self-signed, which means:
- Browsers will show a security warning
- You'll need to click "Advanced" → "Proceed to site" to access the site
- This is normal for development/testing environments

### Production Deployment

For production, you should use certificates from a trusted Certificate Authority (CA):

1. **Let's Encrypt** (Free):
   ```bash
   # Install certbot
   sudo apt install certbot
   
   # Generate certificate
   sudo certbot certonly --standalone -d your-domain.com
   
   # Copy certificates
   sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem backend/ssl/server.key
   sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem backend/ssl/server.crt
   ```

2. **Commercial CA**: Purchase SSL certificates from providers like DigiCert, GlobalSign, etc.

### Firewall Configuration

Make sure both ports are open in your firewall:

```bash
# For Ubuntu/Debian
sudo ufw allow 3001
sudo ufw allow 3443

# For CentOS/RHEL
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --permanent --add-port=3443/tcp
sudo firewall-cmd --reload
```

### Environment Variables

You can customize the ports using environment variables:

```bash
export PORT=3001          # HTTP port
export HTTPS_PORT=3443    # HTTPS port
npm start
```

## Troubleshooting

### 1. Certificate Not Found

If you see "No SSL certificates found, running HTTP only":
- Ensure `backend/ssl/server.key` and `backend/ssl/server.crt` exist
- Check file permissions

### 2. Still Getting Mixed Content Errors

- Verify the frontend is accessing the correct protocol
- Check browser developer console for exact error messages
- Ensure CORS origins include the correct ports

### 3. Browser Security Warning

For self-signed certificates:
1. Click "Advanced" or "Details"
2. Click "Proceed to site" or "Continue to site"
3. Accept the security risk

### 4. Port Already in Use

If ports are busy:
```bash
# Find process using the port
sudo netstat -tlnp | grep :3443

# Kill the process
sudo kill -9 <process_id>
```

## Architecture

```
Frontend (React) ←→ Socket.IO ←→ Backend (Node.js)
     ↓                              ↓
HTTP/HTTPS Detection          HTTP + HTTPS Servers
     ↓                              ↓
Auto-select Port              Port 3001 + 3443
```

The application now seamlessly works with both HTTP and HTTPS, automatically selecting the appropriate protocol and port based on how the page is accessed. 