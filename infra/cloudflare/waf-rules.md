# Prometheus WAF Rules (Cloudflare)

Web Application Firewall rules for protecting the Prometheus platform.

## Managed Rulesets (Enable in Cloudflare Dashboard)

1. **Cloudflare Managed Ruleset** - General web attack protection (SQLi, XSS, RCE)
2. **Cloudflare OWASP Core Ruleset** - OWASP Top 10 coverage
3. **Cloudflare Leaked Credentials Check** - Blocks requests using known-compromised credentials

## Custom WAF Rules

### 1. Rate Limit - API Endpoints

```
Rule name: API Rate Limit
Expression: (http.host eq "api.prometheus.dev" and http.request.uri.path matches "^/api/")
Action: Rate Limit
Rate: 100 requests per 10 seconds per IP
Mitigation timeout: 60 seconds
Response: 429
```

### 2. Rate Limit - Authentication

```
Rule name: Auth Rate Limit
Expression: (http.request.uri.path contains "/auth" or http.request.uri.path contains "/sign-in" or http.request.uri.path contains "/sign-up")
Action: Rate Limit
Rate: 10 requests per minute per IP
Mitigation timeout: 300 seconds
Response: 429
```

### 3. Block Known Bad Bots

```
Rule name: Block Bad Bots
Expression: (cf.client.bot and not cf.bot_management.verified_bot)
Action: Managed Challenge
```

### 4. Block Suspicious User Agents

```
Rule name: Block Suspicious UA
Expression: (http.user_agent contains "sqlmap" or http.user_agent contains "nikto" or http.user_agent contains "nmap" or http.user_agent contains "masscan" or http.user_agent eq "")
Action: Block
```

### 5. Country-Level Block (if needed)

```
Rule name: Geo Block
Expression: (ip.geoip.country in {"XX" "YY"})
Action: Block
Note: Only enable if you have specific compliance requirements
```

### 6. Protect Admin Endpoints

```
Rule name: Admin Protection
Expression: (http.request.uri.path matches "^/admin" or http.request.uri.path matches "^/api/admin")
Action: Managed Challenge
```

### 7. API Key Validation Header

```
Rule name: API Requires Auth Header
Expression: (http.host eq "api.prometheus.dev" and http.request.uri.path matches "^/api/" and not http.request.uri.path matches "^/api/health" and not any(http.request.headers["authorization"][*] matches ".*"))
Action: Block
Response: 401
```

### 8. Large Request Body Protection

```
Rule name: Block Large Payloads
Expression: (http.request.body.size gt 10000000)
Action: Block
Note: 10MB limit; adjust for file upload endpoints if needed
```

## IP Access Rules

| IP/Range | Action | Notes |
|----------|--------|-------|
| Office IP | Allow | Skip WAF for internal traffic |
| CI/CD Runner IPs | Allow | GitHub Actions runners |

## Bot Management

- **Verified Bots**: Allow (Googlebot, Bingbot, etc.)
- **Likely Automated**: Managed Challenge
- **Definitely Automated**: Block (except API routes with valid auth)

## Monitoring

- Enable **Security Events** logging
- Set up notifications for:
  - High rate of blocked requests (>1000/hour)
  - New attack vectors detected
  - Rate limit threshold breaches
