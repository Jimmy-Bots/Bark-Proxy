import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'

// Interface for the webhook rule configuration
interface WebhookRule {
  id: string;                     // Unique identifier for the rule
  name: string;                   // Human-readable name
  mapping: {                      // Mapping from webhook payload to Bark parameters
    title: string;                // Template for title
    body: string;                 // Template for body
    group?: string;               // Optional group
    icon?: string;                // Optional icon URL
    url?: string;                 // Optional URL to open
    sound?: string;               // Optional sound
  };
  barkUrl: string;                // Bark URL to send notification to
}

// Define the KV bindings interface
interface Env {
  RULES_STORE: KVNamespace;
}

// Utility function to extract value from object using dot notation path
function getValueByPath(obj: any, path: string): any {
  if (!obj || typeof obj !== 'object' || !path || typeof path !== 'string') {
    return undefined;
  }
  
  // Validate path to prevent prototype pollution and code injection
  if (!/^[a-zA-Z0-9_.]+$/.test(path)) {
    console.error(`Invalid path format: ${path}`);
    return undefined;
  }
  
  const keys = path.split('.');
  return keys.reduce((o, key) => {
    // Skip empty keys and disallow access to __proto__, constructor, or prototype
    if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return undefined;
    }
    return (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, key)) ? o[key] : undefined;
  }, obj);
}

// Safe evaluation function for template expressions using a limited expression evaluator
function evaluateExpression(expression: string, data: any): any {
  // Define allowed operators and their implementations
  const operators = {
    '===': (a: any, b: any) => a === b,
    '!==': (a: any, b: any) => a !== b,
    '==': (a: any, b: any) => a == b, 
    '!=': (a: any, b: any) => a != b,
    '>': (a: any, b: any) => a > b,
    '<': (a: any, b: any) => a < b,
    '>=': (a: any, b: any) => a >= b,
    '<=': (a: any, b: any) => a <= b,
    '&&': (a: any, b: any) => a && b,
    '||': (a: any, b: any) => a || b,
  };

  try {
    // Handle ternary expressions (most common use case)
    const ternaryMatch = expression.match(/^\s*(.+?)\s*\?\s*(.+?)\s*:\s*(.+?)\s*$/);
    if (ternaryMatch) {
      const [_, condition, trueExpr, falseExpr] = ternaryMatch;
      
      // Parse condition (supports only simple comparisons)
      let conditionResult = false;
      
      for (const [op, func] of Object.entries(operators)) {
        if (condition.includes(op)) {
          const [left, right] = condition.split(op).map(part => {
            part = part.trim();
            // Handle path references
            if (/^[\w.]+$/.test(part)) {
              return getValueByPath(data, part);
            }
            // Handle string literals
            if (/^['"](.*)['"]$/.test(part)) {
              return part.substring(1, part.length - 1);
            }
            // Handle number literals
            if (/^-?\d+(\.\d+)?$/.test(part)) {
              return Number(part);
            }
            // Handle booleans
            if (part === 'true') return true;
            if (part === 'false') return false;
            return part;
          });
          
          conditionResult = func(left, right);
          break;
        }
      }
      
      // Evaluate result based on condition
      if (conditionResult) {
        if (/^['"](.*)['"]$/.test(trueExpr)) {
          return trueExpr.substring(1, trueExpr.length - 1);
        }
        return getValueByPath(data, trueExpr.trim());
      } else {
        if (/^['"](.*)['"]$/.test(falseExpr)) {
          return falseExpr.substring(1, falseExpr.length - 1);
        }
        return getValueByPath(data, falseExpr.trim());
      }
    }
    
    // For non-ternary expressions, just treat as a path
    return getValueByPath(data, expression.trim());
  } catch (error) {
    console.error(`Error evaluating expression: ${expression}`, error);
    return "";
  }
}

// Enhanced template variable replacement function
function replaceTemplateVars(template: string, data: any): string {
  // Handle two types of template variables:
  // 1. Simple path references: ${path.to.value}
  // 2. Expressions: ${path === 'value' ? 'result1' : 'result2'}
  return template.replace(/\${([^}]+)}/g, (match, expression) => {
    // Check if this is a simple path or an expression
    if (/^[\w.]+$/.test(expression)) {
      // Simple path
      const value = getValueByPath(data, expression);
      return value !== undefined ? String(value) : '';
    } else {
      // Expression to evaluate
      return String(evaluateExpression(expression, data) || '');
    }
  });
}

// Function to send notification to Bark
async function sendToBark(rule: WebhookRule, data: any): Promise<Response> {
  const barkParams = {
    title: replaceTemplateVars(rule.mapping.title, data),
    body: replaceTemplateVars(rule.mapping.body, data),
    group: rule.mapping.group ? replaceTemplateVars(rule.mapping.group, data) : undefined,
    icon: rule.mapping.icon ? replaceTemplateVars(rule.mapping.icon, data) : undefined,
    url: rule.mapping.url ? replaceTemplateVars(rule.mapping.url, data) : undefined,
    sound: rule.mapping.sound ? replaceTemplateVars(rule.mapping.sound, data) : undefined
  };

  // Filter out undefined values
  Object.keys(barkParams).forEach(key => 
    barkParams[key] === undefined && delete barkParams[key]
  );
  
  // Convert to URL parameters
  const urlParams = new URLSearchParams();
  Object.entries(barkParams).forEach(([key, value]) => {
    if (value !== undefined) urlParams.append(key, value);
  });
  
  const barkUrlWithParams = rule.barkUrl.includes('?') 
    ? `${rule.barkUrl}&${urlParams.toString()}`
    : `${rule.barkUrl}?${urlParams.toString()}`;
  
  console.log(`Sending to Bark: ${barkUrlWithParams}`);
  
  return fetch(barkUrlWithParams, {
    method: 'GET',
  });
}

// Helper functions for KV operations
async function getAllRules(kv: KVNamespace): Promise<WebhookRule[]> {
  const { keys } = await kv.list({ prefix: 'rule:' });
  if (keys.length === 0) return [];
  
  const rules = await Promise.all(
    keys.map(async (key) => {
      const rule = await kv.get<WebhookRule>(key.name, 'json');
      return rule;
    })
  );
  
  return rules.filter(rule => rule !== null) as WebhookRule[];
}

async function getRuleById(kv: KVNamespace, id: string): Promise<WebhookRule | null> {
  return await kv.get<WebhookRule>(`rule:${id}`, 'json');
}

async function saveRule(kv: KVNamespace, rule: WebhookRule): Promise<void> {
  await kv.put(`rule:${rule.id}`, JSON.stringify(rule));
}

async function deleteRule(kv: KVNamespace, id: string): Promise<boolean> {
  const exists = await kv.get(`rule:${id}`);
  if (!exists) return false;
  
  await kv.delete(`rule:${id}`);
  return true;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => {
  return c.text('Bark-Proxy is Working!')
})

// Endpoint to register/update webhook rules
app.post('/rules', async (c) => {
  try {
    const rule = await c.req.json<WebhookRule>();
    
    // Validate required fields
    if (!rule.id || !rule.name || !rule.mapping || !rule.barkUrl) {
      throw new HTTPException(400, { message: 'Missing required fields' });
    }
    
    await saveRule(c.env.RULES_STORE, rule);
    
    return c.json({ message: 'Rule saved successfully', id: rule.id });
  } catch (error) {
    return c.json({ error: error.message }, 400);
  }
})

// Get all rules
app.get('/rules', async (c) => {
  const rules = await getAllRules(c.env.RULES_STORE);
  return c.json(rules);
})

// Get rule by ID
app.get('/rules/:id', async (c) => {
  const id = c.req.param('id');
  const rule = await getRuleById(c.env.RULES_STORE, id);
  
  if (!rule) {
    return c.json({ error: 'Rule not found' }, 404);
  }
  
  return c.json(rule);
})

// Delete rule
app.delete('/rules/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await deleteRule(c.env.RULES_STORE, id);
  
  if (!deleted) {
    return c.json({ error: 'Rule not found' }, 404);
  }
  
  return c.json({ message: 'Rule deleted successfully' });
})

// Receive webhook and process according to rules
app.post('/push', async (c) => {
  try {
    const requestData = await c.req.json();
    console.log('Received webhook payload:', requestData);
    
    // Get rule ID from request body or query parameter
    const ruleId = requestData.ruleId || c.req.query('ruleId');
    
    if (!ruleId) {
      return c.json({ error: 'Rule ID is required' }, 400);
    }
    
    // Find the rule by ID from KV
    const rule = await getRuleById(c.env.RULES_STORE, ruleId);
    
    if (!rule) {
      return c.json({ error: `Rule not found with ID: ${ruleId}` }, 404);
    }
    
    // Extract payload from request
    const payload = requestData.payload || requestData;
    
    // Send to Bark
    try {
      const response = await sendToBark(rule, payload);
      if (!response.ok) {
        return c.json({ 
          success: false, 
          message: `Failed to send to Bark: ${response.status} ${response.statusText}` 
        }, 500);
      }
      
      return c.json({ success: true, message: 'Notification sent successfully' });
    } catch (error) {
      return c.json({ success: false, message: error.message }, 500);
    }
  } catch (error) {
    return c.json({ error: error.message }, 400);
  }
})

export default app
