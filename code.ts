/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 455, height: 688 });

const PROMPT_TEXT = `You are connected to Figma via MCP.

TASK:
Analyze the Figma component provided via URL and generate structured, useful and clear design documentation.

INPUT:
I will provide a Figma component or component set URL.

INSTRUCTIONS (CRITICAL – FOLLOW EXACTLY):

1. Use Figma MCP to inspect the provided component in detail.
   You MUST extract information directly from the Figma file, including:
   - Component name
   - Component set name (if applicable)
   - Library name (Figma file or library title)
   - Component root layer name
   - Component properties (boolean, variant, slot, text)
   - Available property values
   - Variant names
   - Variant usage inferred from visual design and naming
   - Child components used inside the component (dependencies)
   - Layer names that properties are applied to (when determinable)
   - Read component descriptions, variant descriptions and use them to get more context. Don't directly copy and paste variant descriptions. Use them just for additional context.

2. If a specific value cannot be determined with confidence:
   - Leave the field empty
   - Do NOT guess
   - Do NOT hallucinate

3. Output MUST be a single valid JSON object.
   - NO prose
   - NO markdown
   - NO explanations
   - NO comments
   - NO trailing commas

4. The JSON MUST strictly follow this structure and naming:

{
  "header": {
    "componentName": "",
    "libraryName": "",
    "componentLayerName": "",
    "description": ""
  },
  "properties": [
    {
      "name": "",
      "type": "boolean | variant | slot | text",
      "values": "",
      "appliedTo": {
        "layerName": "",
        "nodeId": ""
      }
    }
  ],
  "variants": [
    {
      "name": "",
      "usage": "",
      "nodeId": ""
    }
  ],
  "dos": [
    {
      "title": "",
      "description": ""
    }
  ],
  "donts": [
    {
      "title": "",
      "description": ""
    }
  ],
  "dependencies": [
    {
      "name": "",
      "link": ""
    }
  ]
}

5. FIELD-SPECIFIC RULES:

- header.componentName  
  → Human-readable component name (e.g. “Button”)

- header.libraryName  
  → Figma file or library name where the component lives

- header.componentLayerName  
  → Exact root layer or component set name in Figma

- header.description  
  → 1–4 sentence concise explanation of purpose and main usage areas. Do not describe what properties does this component have. Instead focus more on what it serves and how it helps users.

- properties:
  - type MUST be one of: boolean, variant, slot, text
  - values:
    - boolean → "true, false"
    - variant → list all available variant values.
	    - Don't separate each value as a separate string in the Json and don't wrap them in brackets. Instead combine them in a single string and use format like this: "values": "Value one, Value two, Value three"
    - slot → empty array if no predefined values, print N/A
    - text → empty array, print N/A
  - appliedTo:
    - If the property affects a specific layer(For example: if boolean is tied to a specific layer), include its name and link to it
    - If not clearly applicable, return empty strings

- variants:
  - Include all visual / semantic variants found in the component. Don't write variant combinations in a single item. Write each variant separately. 
  - For each variant select a single variant as an example from the figma component, get its node ID and include it in json.
  - usage should describe *when to use* and explain the usage purpose, not how it’s built
  - If there is a variant group callaed "State" Don't include it in the variants section of output json

- dos / donts:
  - Generate only rules that are clearly implied by the design
  - Prefer fewer, high-quality entries over generic advice
  - Include as much context as possible. Avoid general, non-specific do's and don'ts that is obvious already. 

- dependencies:
  - Include all nested components (icons, avatars, loaders, etc.)
  - link MUST be a valid Figma URL to the dependency component when possible.

6. OUTPUT CONSTRAINT:
Return ONLY the JSON object.
Any text outside JSON is a failure.

Here is the link to the component:
`;

figma.ui.onmessage = async (msg) => {
  if (msg.type === "OPEN_URL") {
    figma.openExternal(msg.url);
    return;
  }

  if (msg.type === "COPY_PROMPT") {
    if (msg.success) {
      figma.notify("Prompt copied to clipboard");
    } else {
      // Fallback: create a temporary text node with the prompt
      const textNode = figma.createText();
      await figma.loadFontAsync(textNode.fontName as FontName);
      textNode.characters = msg.text;
      
      // Select it so user can copy
      figma.currentPage.selection = [textNode];
      figma.viewport.scrollAndZoomIntoView([textNode]);
      
      figma.notify("Prompt text selected - Press Cmd+C (Mac) or Ctrl+C (Windows) to copy");
      
      // Remove after 2 seconds
      setTimeout(() => {
        textNode.remove();
      }, 2000);
    }
    return;
  }

  if (msg.type !== "RENDER") return;

  // --- Selection validation ---
  const selection = figma.currentPage.selection;
  if (selection.length !== 1 || selection[0].type !== "FRAME") {
    figma.notify("Select exactly one root FRAME");
    return;
  }

  let data: any;
  try {
    data = JSON.parse(msg.json);
  } catch {
    figma.notify("Invalid JSON");
    return;
  }

  const root = selection[0] as FrameNode;

  await renderObject(data, root);

  figma.notify("Documentation rendered");
  figma.closePlugin();
};

/* ============================================================
   Traversal & Rendering
============================================================ */

async function renderObject(obj: any, scope: SceneNode) {
  for (const key of Object.keys(obj)) {
    const value = obj[key];

    if (Array.isArray(value)) {
      await renderArray(key, value, scope);
    } else if (typeof value === "object" && value !== null) {
      if (key === "appliedTo") {
        await renderAppliedTo(value, scope);
      } else {
        await renderObject(value, scope);
      }
    } else {
      // Skip nodeId - it's used for instance creation, not text display
      if (key !== "nodeId") {
        await renderPrimitive(key, value, scope);
      }
    }
  }
}

async function renderPrimitive(
  key: string,
  value: any,
  scope: SceneNode
) {
  const node = findTextNodeByName(scope, key);
  if (!node) return;

  await figma.loadFontAsync(node.fontName as FontName);

  node.characters =
    value === undefined || value === "" ? "N/A" : String(value);
}

async function renderNodeExample(
  nodeId: string,
  scope: SceneNode
) {
  const displayFrame = findNodeByName(scope, "exampleDisplay");
  if (!displayFrame || displayFrame.type !== "FRAME") return;

  // Clear existing content from exampleDisplay
  const frameNode = displayFrame as FrameNode;
  for (const child of [...frameNode.children]) {
    child.remove();
  }

  // Get node by ID (use async version for dynamic-page document access)
  const sourceNode = await figma.getNodeByIdAsync(nodeId);
  if (!sourceNode) return;

  // Create instance if it's a component
  if (sourceNode.type === "COMPONENT") {
    const instance = sourceNode.createInstance();
    frameNode.appendChild(instance);
  }
}

async function renderArray(
  sectionName: string,
  items: any[],
  scope: SceneNode
) {
  const section = findNodeByName(scope, sectionName);
  if (!section || !("children" in section)) return;

  const list = findNodeByName(section, "list");
  if (!list || !("children" in list)) return;

  const template = list.children.find(
    (c) => c.type === "FRAME" && c.name === "item"
  ) as FrameNode | undefined;

  if (!template) return;

  // Clear existing items
  for (const child of [...list.children]) {
    if (child !== template) child.remove();
  }

  if (items.length === 0) {
    template.remove();
    return;
  }

  for (const item of items) {
    const clone = template.clone();
    list.appendChild(clone);
    
    // Use special renderer for dependencies to create hyperlinks
    if (sectionName === "dependencies") {
      await renderDependency(item, clone);
    } else {
      await renderObject(item, clone);
      
      // Render component instance if nodeId is provided
      if (item.nodeId) {
        await renderNodeExample(item.nodeId, clone);
      }
    }
  }

  template.remove();
}

async function renderAppliedTo(
  appliedTo: { layerName?: string; nodeId?: string },
  scope: SceneNode
) {
  const node = findTextNodeByName(scope, "appliedTo");
  if (!node) return;

  await figma.loadFontAsync(node.fontName as FontName);

  if (!appliedTo.layerName) {
    node.characters = "N/A";
    node.setRangeHyperlink(0, node.characters.length, null);
    return;
  }

  node.characters = appliedTo.layerName;

  if (appliedTo.nodeId) {
    const url = `https://www.figma.com/file/${figma.fileKey}?node-id=${appliedTo.nodeId}`;
    node.setRangeHyperlink(0, node.characters.length, {
      type: "URL",
      value: url
    });
  } else {
    node.setRangeHyperlink(0, node.characters.length, null);
  }
}

/* ============================================================
   Dependency renderer override
============================================================ */

async function renderDependency(
  dep: { name?: string; link?: string },
  scope: SceneNode
) {
  const node = findTextNodeByName(scope, "name");
  if (!node) return;

  await figma.loadFontAsync(node.fontName as FontName);

  if (!dep.name) {
    node.characters = "N/A";
    node.setRangeHyperlink(0, node.characters.length, null);
    return;
  }

  node.characters = dep.name;

  if (dep.link) {
    node.setRangeHyperlink(0, node.characters.length, {
      type: "URL",
      value: dep.link
    });
  } else {
    node.setRangeHyperlink(0, node.characters.length, null);
  }
}

/* ============================================================
   Matchers (recursive, grouping-safe)
============================================================ */

function findTextNodeByName(
  node: SceneNode,
  name: string
): TextNode | null {
  if (node.type === "TEXT" && node.name === name) {
    return node;
  }

  if (!("children" in node)) return null;

  for (const child of node.children) {
    const found = findTextNodeByName(child, name);
    if (found) return found;
  }

  return null;
}

function findNodeByName(
  node: SceneNode,
  name: string
): SceneNode | null {
  if (node.name === name) return node;

  if (!("children" in node)) return null;

  for (const child of node.children) {
    const found = findNodeByName(child, name);
    if (found) return found;
  }

  return null;
}
