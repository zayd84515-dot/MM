const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || "data");
const DATABASE_FILE = path.join(DATA_DIR, "store.sqlite");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const GEMINI_GENERATION_TIMEOUT_MS = 60_000;
const PORT = Number(process.env.PORT) || 3000;
const sessions = new Map();

const initialProducts = [
  {
    id: "afia-cotton-shirt",
    name: "قميص قطني كلاسيكي",
    category: "رجالي",
    price: 650,
    oldPrice: 820,
    image: "https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=900&q=85",
    description: "قميص قطني ناعم بقصة مريحة، مثالي لإطلالة يومية أنيقة.",
    sizes: ["S", "M", "L", "XL"],
    featured: true
  },
  {
    id: "afia-linen-dress",
    name: "فستان كتان صيفي",
    category: "نسائي",
    price: 980,
    oldPrice: null,
    image: "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=900&q=85",
    description: "فستان خفيف من الكتان الطبيعي، راحة وأناقة في كل مناسبة.",
    sizes: ["S", "M", "L"],
    featured: true
  },
  {
    id: "afia-everyday-hoodie",
    name: "سويت شيرت يومي",
    category: "رجالي",
    price: 790,
    oldPrice: 950,
    image: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=900&q=85",
    description: "خامة ناعمة ودافئة بتصميم بسيط يناسب كل يوم.",
    sizes: ["M", "L", "XL"],
    featured: true
  },
  {
    id: "afia-soft-knit",
    name: "بلوزة تريكو ناعمة",
    category: "نسائي",
    price: 720,
    oldPrice: null,
    image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=900&q=85",
    description: "بلوزة أنيقة بخامة مريحة وتفاصيل بسيطة تضيف لمسة مميزة.",
    sizes: ["S", "M", "L", "XL"],
    featured: true
  },
  {
    id: "afia-denim-jacket",
    name: "جاكيت جينز عصري",
    category: "رجالي",
    price: 1250,
    oldPrice: null,
    image: "https://images.unsplash.com/photo-1516257984-b1b4d707412e?auto=format&fit=crop&w=900&q=85",
    description: "قطعة أساسية متعددة الاستخدامات، بخامة جينز متينة وقصة عصرية.",
    sizes: ["M", "L", "XL"],
    featured: false
  },
  {
    id: "afia-summer-top",
    name: "توب صيفي مريح",
    category: "نسائي",
    price: 540,
    oldPrice: null,
    image: "https://images.unsplash.com/photo-1551488831-00ddcb6c6bd3?auto=format&fit=crop&w=900&q=85",
    description: "قطعة خفيفة بألوان هادئة، مثالية لأيام الصيف.",
    sizes: ["S", "M", "L"],
    featured: false
  }
];

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const database = new DatabaseSync(DATABASE_FILE);
database.exec(`
  CREATE TABLE IF NOT EXISTS store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    old_price REAL,
    image TEXT NOT NULL,
    description TEXT NOT NULL,
    sizes TEXT NOT NULL,
    featured INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    items TEXT NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

function saveStore(store) {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec("DELETE FROM products; DELETE FROM orders;");
    const insertProduct = database.prepare(`
      INSERT INTO products (id, name, category, price, old_price, image, description, sizes, featured)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertOrder = database.prepare(`
      INSERT INTO orders (id, name, phone, address, items, total, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const product of store.products) {
      insertProduct.run(
        product.id, product.name, product.category, product.price, product.oldPrice,
        product.image, product.description, JSON.stringify(product.sizes), Number(product.featured)
      );
    }
    for (const order of store.orders) {
      insertOrder.run(
        order.id, order.name, order.phone, order.address, JSON.stringify(order.items),
        order.total, order.status, order.createdAt
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function loadStore() {
  const initialized = database.prepare("SELECT value FROM store_meta WHERE key = ?").get("seeded");
  if (!initialized) {
    saveStore({ products: initialProducts, orders: [] });
    database.prepare("INSERT INTO store_meta (key, value) VALUES (?, ?)").run("seeded", "true");
  }
  const products = database.prepare("SELECT * FROM products ORDER BY rowid").all().map(product => ({
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    oldPrice: product.old_price,
    image: product.image,
    description: product.description,
    sizes: JSON.parse(product.sizes),
    featured: Boolean(product.featured)
  }));
  const orders = database.prepare("SELECT * FROM orders ORDER BY rowid DESC").all().map(order => ({
    id: order.id,
    name: order.name,
    phone: order.phone,
    address: order.address,
    items: JSON.parse(order.items),
    total: order.total,
    status: order.status,
    createdAt: order.created_at
  }));
  return { products, orders };
}

let store = loadStore();

const geminiInstruction = "أنت مساعد متجر عافية للملابس. أجب بالعربية المصرية الودودة وباختصار. ساعد في اختيار الملابس والمقاسات وسياسة الشراء. لا تخترع معلومات عن المخزون أو مواعيد التوصيل. إذا لم تعرف إجابة، وجّه العميل للتواصل مع خدمة العملاء.";

function geminiRequestUrl(model) {
  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`);
  url.searchParams.set("key", process.env.GEMINI_API_KEY);
  return url;
}

async function fetchGeminiModel(model, contents) {
  return fetch(geminiRequestUrl(model), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: geminiInstruction }] },
      contents,
      generationConfig: { maxOutputTokens: 400 }
    }),
    signal: AbortSignal.timeout(GEMINI_GENERATION_TIMEOUT_MS)
  });
}

async function findAvailableFlashModel(excludedModel) {
  const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
  url.searchParams.set("key", process.env.GEMINI_API_KEY);
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Gemini returned an unreadable model list.");
  }
  if (!response.ok) {
    const error = new Error(result.error?.message || `Gemini model list failed with HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }

  const available = Array.isArray(result.models)
    ? result.models
      .filter(model => model.supportedGenerationMethods?.includes("generateContent"))
      .map(model => String(model.name || "").replace(/^models\//, ""))
      .filter(name => name !== excludedModel && /^gemini-.+flash/i.test(name) && !/(?:tts|live|image|audio|embedding)/i.test(name))
    : [];
  const preferred = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
  return preferred.find(name => available.includes(name))
    || available.find(name => !/(?:preview|experimental|lite)/i.test(name))
    || available[0]
    || null;
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

function readBody(request, maxBytes = 100_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) tooLarge = true;
      else chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) {
        const error = new Error("الطلب أكبر من الحجم المسموح.");
        error.statusCode = 413;
        return reject(error);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error("صيغة البيانات غير صحيحة.");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function isAdmin(request) {
  const cookie = request.headers.cookie || "";
  const token = cookie.match(/(?:^|;\s*)afia_admin=([a-f0-9]+)/)?.[1];
  const expiresAt = token && sessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(request, response) {
  if (isAdmin(request)) return true;
  sendJson(response, 401, { error: "سجّل الدخول إلى لوحة الإدارة أولاً." });
  return false;
}

function validProduct(product) {
  return product
    && typeof product.name === "string" && product.name.trim().length > 0 && product.name.length <= 100
    && typeof product.category === "string" && product.category.trim().length > 0
    && Number.isFinite(Number(product.price)) && Number(product.price) > 0
    && typeof product.image === "string" && product.image.trim().length > 0
    && typeof product.description === "string"
    && Array.isArray(product.sizes) && product.sizes.length > 0 && product.sizes.length <= 10
    && product.sizes.every(size => typeof size === "string" && size.trim().length > 0 && size.length <= 20);
}

async function handleApi(request, response, url) {
  const route = url.pathname;

  if (route === "/api/products" && request.method === "GET") {
    return sendJson(response, 200, store.products);
  }

  if (route === "/api/admin/login" && request.method === "POST") {
    if (!process.env.ADMIN_PASSWORD) {
      return sendJson(response, 503, { error: "إعداد ADMIN_PASSWORD على الخادم مطلوب لتفعيل لوحة الإدارة." });
    }
    const body = await readBody(request);
    const supplied = Buffer.from(String(body.password || ""));
    const expected = Buffer.from(process.env.ADMIN_PASSWORD);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      return sendJson(response, 401, { error: "كلمة المرور غير صحيحة." });
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": `afia_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`
    });
    return response.end(JSON.stringify({ ok: true }));
  }

  if (route === "/api/admin/logout" && request.method === "POST") {
    const token = (request.headers.cookie || "").match(/(?:^|;\s*)afia_admin=([a-f0-9]+)/)?.[1];
    if (token) sessions.delete(token);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": "afia_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
    });
    return response.end(JSON.stringify({ ok: true }));
  }

  if (route === "/api/orders" && request.method === "POST") {
    const body = await readBody(request);
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const address = String(body.address || "").trim();
    const cart = Array.isArray(body.items) ? body.items : [];
    if (name.length < 2 || name.length > 100 || !/^[+()\d\s-]{7,20}$/.test(phone)
      || address.length < 6 || address.length > 500 || cart.length < 1 || cart.length > 30) {
      return sendJson(response, 400, { error: "راجع الاسم ورقم الهاتف والعنوان والمنتجات المطلوبة." });
    }
    const items = [];
    for (const requested of cart) {
      const product = store.products.find(item => item.id === requested.id);
      const quantity = Number(requested.quantity);
      const size = String(requested.size || "");
      if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20
        || !product.sizes.includes(size)) {
        return sendJson(response, 400, { error: "أحد المنتجات أو المقاسات لم يعد متاحًا. حدّث السلة وحاول مرة أخرى." });
      }
      items.push({ id: product.id, name: product.name, price: Number(product.price), quantity, size });
    }
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const order = {
      id: `AF-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`,
      name, phone, address, items, total, status: "جديد", createdAt: new Date().toISOString()
    };
    store.orders.unshift(order);
    saveStore(store);
    return sendJson(response, 201, { id: order.id });
  }

  if (route.startsWith("/api/admin/")) {
    if (!requireAdmin(request, response)) return;

    if (route === "/api/admin/upload-image" && request.method === "POST") {
      const body = await readBody(request, 7 * 1024 * 1024);
      const contentTypes = {
        "image/jpeg": { extension: "jpg", matches: data => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff },
        "image/png": { extension: "png", matches: data => data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
        "image/webp": { extension: "webp", matches: data => data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP" }
      };
      const contentType = typeof body?.contentType === "string" ? body.contentType : "";
      const encodedImage = typeof body?.data === "string" ? body.data : "";
      const imageType = Object.hasOwn(contentTypes, contentType) ? contentTypes[contentType] : null;
      if (!imageType || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedImage)) {
        return sendJson(response, 400, { error: "اختاري صورة بصيغة JPG أو PNG أو WebP." });
      }
      const image = Buffer.from(encodedImage, "base64");
      if (image.length === 0 || image.length > MAX_IMAGE_SIZE) {
        return sendJson(response, 400, { error: "حجم الصورة لازم يكون 5 ميجابايت أو أقل." });
      }
      if (!imageType.matches(image)) {
        return sendJson(response, 400, { error: "محتوى الصورة لا يطابق نوع الملف. اختاري صورة JPG أو PNG أو WebP سليمة." });
      }
      const filename = `${crypto.randomUUID()}.${imageType.extension}`;
      await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), image, { flag: "wx" });
      return sendJson(response, 201, { image: `/uploads/${filename}` });
    }

    if (route === "/api/admin/orders" && request.method === "GET") {
      return sendJson(response, 200, store.orders);
    }
    if (route === "/api/admin/products" && request.method === "POST") {
      const body = await readBody(request);
      if (!validProduct(body)) return sendJson(response, 400, { error: "بيانات المنتج ناقصة أو غير صحيحة." });
      const product = {
        id: crypto.randomUUID(),
        name: body.name.trim(),
        category: body.category.trim(),
        price: Number(body.price),
        oldPrice: Number(body.oldPrice) > 0 ? Number(body.oldPrice) : null,
        image: body.image.trim(),
        description: body.description.trim(),
        sizes: body.sizes.map(size => String(size).trim()).filter(Boolean).slice(0, 10),
        featured: Boolean(body.featured)
      };
      store.products.unshift(product);
      saveStore(store);
      return sendJson(response, 201, product);
    }
    const productMatch = route.match(/^\/api\/admin\/products\/([^/]+)$/);
    if (productMatch && request.method === "PUT") {
      const index = store.products.findIndex(item => item.id === decodeURIComponent(productMatch[1]));
      if (index < 0) return sendJson(response, 404, { error: "المنتج غير موجود." });
      const body = await readBody(request);
      if (!validProduct(body)) return sendJson(response, 400, { error: "بيانات المنتج ناقصة أو غير صحيحة." });
      store.products[index] = {
        ...store.products[index],
        name: body.name.trim(), category: body.category.trim(), price: Number(body.price),
        oldPrice: Number(body.oldPrice) > 0 ? Number(body.oldPrice) : null,
        image: body.image.trim(), description: body.description.trim(),
        sizes: body.sizes.map(size => String(size).trim()).filter(Boolean).slice(0, 10),
        featured: Boolean(body.featured)
      };
      saveStore(store);
      return sendJson(response, 200, store.products[index]);
    }
    if (productMatch && request.method === "DELETE") {
      const id = decodeURIComponent(productMatch[1]);
      const count = store.products.length;
      store.products = store.products.filter(item => item.id !== id);
      if (store.products.length === count) return sendJson(response, 404, { error: "المنتج غير موجود." });
      saveStore(store);
      return sendJson(response, 200, { ok: true });
    }
    const orderMatch = route.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if (orderMatch && request.method === "PATCH") {
      const order = store.orders.find(item => item.id === decodeURIComponent(orderMatch[1]));
      if (!order) return sendJson(response, 404, { error: "الطلب غير موجود." });
      const body = await readBody(request);
      if (!["جديد", "قيد التجهيز", "تم الشحن", "مكتمل", "ملغي"].includes(body.status)) {
        return sendJson(response, 400, { error: "حالة الطلب غير صحيحة." });
      }
      order.status = body.status;
      saveStore(store);
      return sendJson(response, 200, order);
    }
    return sendJson(response, 404, { error: "المسار غير موجود." });
  }

  if (route === "/api/chat" && request.method === "POST") {
    if (!process.env.GEMINI_API_KEY) {
      return sendJson(response, 503, { error: "المساعد الذكي غير مفعّل حاليًا. تواصل معنا على واتساب للمساعدة." });
    }
    const body = await readBody(request);
    const message = String(body.message || "").trim();
    if (!message || message.length > 1000) return sendJson(response, 400, { error: "اكتب رسالة من 1 إلى 1000 حرف." });
    const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
    const contents = history
      .filter(item => item && ["user", "model"].includes(item.role) && typeof item.text === "string")
      .map(item => ({ role: item.role, parts: [{ text: item.text.slice(0, 1000) }] }));
    contents.push({ role: "user", parts: [{ text: message }] });
    let upstream;
    try {
      const configuredModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
      upstream = await fetchGeminiModel(configuredModel, contents);
      if (upstream.status === 404) {
        const availableModel = await findAvailableFlashModel(configuredModel);
        if (!availableModel) {
          console.error("Gemini request failed: no generateContent Flash model is available for this API key.");
          return sendJson(response, 502, {
            error: "المفتاح لا يتيح أي نموذج Gemini Flash للمحادثة. أنشئ مفتاحًا من مشروع مفعّل فيه Gemini API، وتحقق من النماذج المتاحة لهذا المشروع."
          });
        }
        console.warn(`Configured Gemini model is unavailable; retrying with an available Flash model (${availableModel}).`);
        upstream = await fetchGeminiModel(availableModel, contents);
      }
    } catch (error) {
      if (Number.isInteger(error.status)) {
        console.error(`Gemini model discovery failed with HTTP ${error.status}.`);
        if (error.status === 401 || error.status === 400) {
          return sendJson(response, 502, { error: "مفتاح Gemini غير صالح أو الطلب مرفوض. راجع المفتاح وفعّل Gemini API للمشروع." });
        }
        if (error.status === 403) {
          return sendJson(response, 502, { error: "المفتاح لا يملك صلاحية عرض نماذج Gemini. راجع إعدادات Gemini API للمشروع." });
        }
        if (error.status === 429) {
          return sendJson(response, 503, { error: "حصة Gemini الحالية غير متاحة أو استُهلكت. راجع الحصة والفوترة في Google AI Studio." });
        }
        return sendJson(response, 502, { error: "تعذّر التحقق من نماذج Gemini المتاحة للمفتاح. راجع إعدادات Gemini API للمشروع." });
      }
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        console.error("Gemini request timed out.");
        return sendJson(response, 504, { error: "استغرق رد Gemini أكثر من دقيقة. جرّب مرة أخرى، أو تحقق من استجابة النموذج واتصال الإنترنت." });
      }
      if (error instanceof TypeError) {
        console.error("Gemini network request failed:", error.message);
        return sendJson(response, 502, { error: "تعذر الاتصال بخدمة Gemini. تحقق من اتصال الخادم بالإنترنت وحاول مرة أخرى." });
      }
      console.error("Gemini model discovery failed:", error.message);
      return sendJson(response, 502, { error: "تعذّر التحقق من نماذج Gemini المتاحة للمفتاح. راجع إعدادات Gemini API للمشروع." });
    }
    let result;
    try {
      result = await upstream.json();
    } catch (error) {
      console.error("Gemini returned an unreadable response:", error.message);
      return sendJson(response, 502, { error: "وصل رد غير مفهوم من خدمة Gemini. حاول مرة أخرى بعد قليل." });
    }
    if (!upstream.ok) {
      const upstreamMessage = result.error?.message || "";
      if (/API key not valid|API_KEY_INVALID|invalid API key|API key expired/i.test(upstreamMessage)) {
        console.error("Gemini request failed: the configured API key is invalid.");
        return sendJson(response, 502, {
          error: "مفتاح Gemini الحالي غير صالح. أنشئ مفتاحًا جديدًا من Google AI Studio، حدّث GEMINI_API_KEY في ملف .env، ثم أعد تشغيل المتجر."
        });
      }
      if (upstream.status === 429 || result.error?.status === "RESOURCE_EXHAUSTED") {
        console.error("Gemini request failed: API quota or rate limit reached.");
        return sendJson(response, 503, {
          error: "حصة Gemini الحالية غير متاحة أو استُهلكت. راجع الحصة والفوترة لمشروع المفتاح في Google AI Studio، ثم حاول لاحقًا."
        });
      }
      if (upstream.status === 403 || result.error?.status === "PERMISSION_DENIED") {
        console.error("Gemini request failed: API permission denied.");
        return sendJson(response, 502, {
          error: "Google رفضت استخدام المفتاح. تأكد أن Gemini API مفعّلة وأن المفتاح مسموح له باستخدامها في Google AI Studio."
        });
      }
      if (upstream.status === 404 || result.error?.status === "NOT_FOUND") {
        console.error("Gemini request failed: configured model or API endpoint was not found.");
        return sendJson(response, 502, {
          error: "تعذّر استخدام نموذج Gemini الذي أتاحه المفتاح. تأكد أن Gemini API مفعّلة في المشروع، ثم راجع النماذج المدعومة للمفتاح."
        });
      }
      console.error("Gemini request failed:", upstreamMessage || upstream.status);
      return sendJson(response, 502, { error: "تعذر الحصول على رد من Gemini. تحقق من المفتاح وصلاحيات API وحاول مرة أخرى." });
    }
    const text = result.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("").trim();
    if (!text) return sendJson(response, 502, { error: "لم يصل رد صالح من المساعد. حاول مرة أخرى." });
    return sendJson(response, 200, { reply: text });
  }

  return sendJson(response, 404, { error: "المسار غير موجود." });
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);

    const uploadedImageMatch = url.pathname.match(/^\/uploads\/([a-f0-9-]+\.(?:jpg|png|webp))$/);
    if (uploadedImageMatch && request.method === "GET") {
      const imagePath = path.join(UPLOAD_DIR, uploadedImageMatch[1]);
      return fs.readFile(imagePath, (error, content) => {
        if (error) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          return response.end("الصورة غير موجودة");
        }
        response.writeHead(200, {
          "Content-Type": contentTypes[path.extname(imagePath)],
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff"
        });
        response.end(content);
      });
    }

    const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
    if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
      return sendJson(response, 403, { error: "غير مسموح." });
    }
    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return response.end("الصفحة غير موجودة");
      }
      response.writeHead(200, {
        "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin"
      });
      response.end(content);
    });
  } catch (error) {
    console.error("Request failed:", error);
    if (!response.headersSent) sendJson(response, error.statusCode || 500, { error: error.statusCode ? error.message : "حدث خطأ غير متوقع. حاول مرة أخرى." });
    else response.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`متجر عافية يعمل على http://localhost:${PORT}`);
  if (!process.env.ADMIN_PASSWORD) console.warn("ADMIN_PASSWORD is not set; admin login is disabled.");
  if (!process.env.GEMINI_API_KEY) console.warn("GEMINI_API_KEY is not set; AI chat is disabled.");
});

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(`المنفذ ${PORT} مستخدم بالفعل. إذا كان المتجر مفتوحًا على http://localhost:${PORT} فلا تشغّل نسخة ثانية. أوقف الخادم الأول بـ Ctrl+C في نافذته قبل إعادة تشغيله.`);
  } else {
    console.error("تعذر تشغيل خادم عافية:", error.message);
  }
  database.close();
  process.exitCode = 1;
});
