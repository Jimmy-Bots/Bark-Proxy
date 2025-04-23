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
  const keys = path.split('.');
  return keys.reduce((o, key) => (o && o[key] !== undefined) ? o[key] : undefined, obj);
}

// Utility function to replace template variables in string
function replaceTemplateVars(template: string, data: any): string {
  return template.replace(/\${([\w.]+)}/g, (_, path) => {
    const value = getValueByPath(data, path);
    return value !== undefined ? String(value) : '';
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
    sound: rule.mapping.sound
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
