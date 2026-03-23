# Prometheus DNS Configuration

DNS records managed via Cloudflare for the Prometheus platform.

## Domain: prometheus.dev (example)

### A Records

| Name | Value | Proxy | TTL |
|------|-------|-------|-----|
| `@` | 185.241.151.197 | Proxied | Auto |
| `api` | 185.241.151.197 | Proxied | Auto |
| `ws` | 185.241.151.197 | DNS Only | Auto |
| `minio` | 185.241.151.197 | DNS Only | Auto |

### CNAME Records

| Name | Target | Proxy | TTL |
|------|--------|-------|-----|
| `www` | `@` | Proxied | Auto |
| `docs` | `@` | Proxied | Auto |
| `staging` | `@` | Proxied | Auto |
| `staging-api` | `@` | Proxied | Auto |

### Notes

- WebSocket endpoint (`ws`) must be DNS Only (gray cloud) to avoid Cloudflare buffering issues with long-lived connections. Alternatively, enable WebSocket support in Cloudflare dashboard under Network settings.
- MinIO endpoint uses DNS Only for direct S3-compatible access.
- All proxied records benefit from Cloudflare CDN caching, DDoS protection, and WAF.

## SSL/TLS

- Mode: **Full (Strict)**
- Edge Certificates: Cloudflare Universal SSL (auto-managed)
- Origin Server: Use Cloudflare Origin CA certificate or Let's Encrypt
- Minimum TLS Version: **1.2**
- Always Use HTTPS: **Enabled**
- HSTS: **Enabled** (max-age=31536000, includeSubDomains)

## Page Rules / Cache Rules

| Rule | Setting |
|------|---------|
| `api.*` | Cache Level: Bypass |
| `ws.*` | Cache Level: Bypass |
| `*.js, *.css, *.woff2` | Cache Level: Cache Everything, Edge TTL: 1 month |
| `/_next/static/*` | Cache Level: Cache Everything, Edge TTL: 1 year |

## Terraform Reference

If managing DNS via Terraform, use the `cloudflare_record` resource:

```hcl
resource "cloudflare_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = "api"
  content = "185.241.151.197"
  type    = "A"
  proxied = true
  ttl     = 1  # Auto when proxied
}

resource "cloudflare_record" "ws" {
  zone_id = var.cloudflare_zone_id
  name    = "ws"
  content = "185.241.151.197"
  type    = "A"
  proxied = false  # DNS Only for WebSocket
  ttl     = 300
}
```
