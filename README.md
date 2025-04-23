# 📱 Bark Proxy

A configurable webhook-to-Bark notification proxy service that allows you to transform incoming webhook payloads into Bark app notifications using customizable rules.

## 🔍 Overview

Bark Proxy is a Cloudflare Workers service that:

- 📥 Receives webhook payloads from various services
- 🔄 Transforms them based on predefined rules
- 📤 Forwards them to the [Bark](https://github.com/Finb/Bark) notification app
- 💾 Stores rules persistently in Cloudflare KV storage

## 🚀 Installation

### 📋 Prerequisites

- Node.js (14.x or later)
- A Cloudflare account
- Wrangler CLI (`npm install -g wrangler`)

### ⚙️ Setup

1. Clone this repository:
   ```bash
   git clone https://github.com/Jimmy-Bots/bark_proxy.git
   cd bark_proxy
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create Cloudflare KV namespaces:
   ```bash
   wrangler kv namespace create "bark_proxy_rule"
   ```

4. Update wrangler.toml with your KV namespace IDs:
   ```toml
   [[kv_namespaces]]
   binding = "bark_proxy_rule"
   id = "YOUR_KV_NAMESPACE_ID"  # Replace with actual ID
   ```

5. Deploy to Cloudflare Workers:
   ```bash
   # Deploy to production
   wrangler deploy
   ```

## 📘 API Documentation

### 📝 Rule Management

#### ✨ Create or Update a Rule

```
POST /rules
```

Request body:
```json
{
  "id": "github-issues",
  "name": "GitHub Issues",
  "mapping": {
    "title": "Issue: ${issue.title}",
    "body": "Created by ${sender.login}\n\n${issue.body}",
    "group": "GitHub",
    "url": "${issue.html_url}",
    "sound": "alarm"
  },
  "barkUrl": "https://api.day.app/YOUR_BARK_KEY"
}
```

Required fields:
- `id`: Unique identifier for the rule
- `name`: Human-readable name
- `mapping`: Template mapping with required `title` and `body` fields
- `barkUrl`: Your Bark URL with key

> **Beta Feature**: The template mapping supports basic ternary operations like `${condition ? trueValue : falseValue}`. This feature is experimental and may contain bugs.


#### 📋 Get All Rules

```
GET /rules
```

Returns an array of all configured rules.

#### 🔍 Get Rule by ID

```
GET /rules/:id
```

Returns a specific rule by its ID.

#### 🗑️ Delete Rule

```
DELETE /rules/:id
```

Deletes a rule by its ID.

### 🔄 Webhook Processing

#### 📤 Process a Webhook

```
POST /push
```

Request body can be in one of these formats:

1. With explicit rule ID:
```json
{
  "ruleId": "github-issues",
  "payload": {
    "issue": {
      "title": "Example issue",
      "body": "This is a test issue",
      "html_url": "https://github.com/user/repo/issues/1"
    },
    "sender": {
      "login": "username"
    }
  }
}
```

2. With rule ID in query parameter:
```
POST /push?ruleId=github-issues
```
with the webhook payload in the request body.

## 🧩 Template Variables

Templates use the `${path.to.value}` syntax to extract values from the webhook payload:

- `${issue.title}` will be replaced with the value from `payload.issue.title`
- `${sender.login}` will be replaced with the value from `payload.sender.login`

## 💡 Example Use Cases

### 🐙 GitHub Webhooks

```json
{
  "id": "github-issue",
  "name": "GitHub Issue Notification",
  "mapping": {
    "title": "GitHub: ${repository.name} - Issue #${issue.number}",
    "body": "${issue.title}\n\nOpened by: ${issue.user.login}\n${issue.body}",
    "group": "GitHub",
    "url": "${issue.html_url}",
    "sound": "minuet"
  },
  "barkUrl": "https://api.day.app/YOUR_BARK_KEY"
}
```

### 🏗️ Jenkins Build Notifications

```json
{
  "id": "jenkins-build",
  "name": "Jenkins Build Status",
  "mapping": {
    "title": "Build ${build.status}",
    "body": "${build.fullDisplayName}\n\nResult: ${build.result}\nDuration: ${build.durationString}",
    "group": "Jenkins",
    "icon": "${build.status === 'SUCCESS' ? 'https://example.com/success.png' : 'https://example.com/fail.png'}",
    "sound": "${build.status === 'SUCCESS' ? 'succeed' : 'warning'}"
  },
  "barkUrl": "https://api.day.app/YOUR_BARK_KEY"
}
```

## 👨‍💻 Development

### 🔧 Local Development

1. Start the local development server:
   ```bash
   wrangler dev
   ```

2. Test your endpoints:
   ```bash
   curl -X POST http://host:port/rules -H "Content-Type: application/json" -d '{"id":"test","name":"Test Rule","mapping":{"title":"Test Title","body":"Test Body"},"barkUrl":"https://api.day.app/YOUR_KEY"}'
   ```

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- [Bark](https://github.com/Finb/Bark) - iOS notification service
- [Hono](https://github.com/honojs/hono) - Ultrafast web framework for Cloudflare Workers
- [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless execution environment
