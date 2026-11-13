"use strict";

const DEMO_SESSION_KEY = "quickbill.demo-session";

const STORAGE_KEYS = {
    receipts: "ledgerly.receipts.v1",
    products: "ledgerly.products.v1",
    inventory: "ledgerly.inventory.v1",
    settings: "ledgerly.settings.v1"
};
const get = (id) => document.getElementById(id);
let products = [];
let receipts = readStorage(STORAGE_KEYS.receipts, []);
let legacyCatalog = readStorage(STORAGE_KEYS.products, []).filter((item) => typeof item === "string");
let inventory = readStorage(STORAGE_KEYS.inventory, []).filter((item) =>
    item && typeof item.name === "string" && Number.isSafeInteger(item.stock) && item.stock >= 0);
let settings = Object.assign({
    storeName: "",
    address: "",
    contact: "",
    gstin: "",
    taxRate: "0"
}, readObject(STORAGE_KEYS.settings));
let receiptGenerated = false;
let currentReceiptId = "";
let activeReceipt = null;

function readStorage(key, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(key));
        return Array.isArray(value) ? value : fallback;
    } catch (error) {
        return fallback;
    }
}

function readObject(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key));
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (error) {
        return {};
    }
}

function writeStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        showFeedback("Could not save to this browser. Check available storage and try again.", true);
        return false;
    }
}

function showFeedback(message, isError) {
    const feedback = get("feedback");
    feedback.textContent = message;
    feedback.classList.toggle("error", Boolean(isError));
}

function formatMoney(paise) {
    const value = BigInt(paise);
    const whole = value / 100n;
    const fraction = String(value % 100n).padStart(2, "0");
    const formattedWhole = new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(whole);
    return `${formattedWhole}.${fraction}`;
}

function paiseToDecimal(paise) {
    const value = BigInt(paise);
    return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

function priceToPaise(value, allowZero) {
    const match = String(value).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (!match) return null;
    const whole = Number(match[1]);
    const fraction = Number((match[2] || "").padEnd(2, "0"));
    const paise = whole * 100 + fraction;
    return Number.isSafeInteger(paise) && (allowZero ? paise >= 0 : paise > 0) ? paise : null;
}

function parseRate(value) {
    const match = String(value).trim().match(/^(\d{1,3})(?:\.(\d{1,2}))?$/);
    if (!match) return null;
    const basisPoints = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
    return Number.isSafeInteger(basisPoints) && basisPoints <= 10000 ? basisPoints : null;
}

function normalizePhone(value) {
    const input = value.trim();
    if (!/^\+?[0-9\s()-]+$/.test(input)) return null;
    let digits = input.replace(/\D/g, "");
    if (digits.startsWith("0091")) digits = digits.slice(4);
    else if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
    if (!/^[6-9]\d{9}$/.test(digits)) return null;
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

function invalidateReceipt(clearId) {
    receiptGenerated = false;
    if (clearId) {
        currentReceiptId = "";
        activeReceipt = null;
    }
    get("receiptStatus").textContent = "Draft";
    get("receiptBadge").textContent = "DRAFT";
    get("receiptNumber").textContent = "Draft";
    get("receiptDate").textContent = "—";
    get("printReceipt").disabled = true;
}

function getBillTotal() {
    let total = 0;
    for (const product of products) {
        const amount = product.quantity * product.pricePaise;
        if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(total + amount)) return null;
        total += amount;
    }
    return total;
}

function getAdjustments(subtotalPaise) {
    const type = get("discountType").value;
    const rawDiscount = get("discountValue").value.trim();
    const taxRateBps = parseRate(get("taxRate").value);
    let discountPaise = 0;
    if (type !== "none") {
        if (!rawDiscount || Number(rawDiscount) < 0) return { error: "Enter a valid discount amount or percentage." };
        if (type === "percent") {
            const rate = parseRate(rawDiscount);
            if (rate === null) return { error: "Discount percentage must be between 0 and 100." };
            discountPaise = percentageOfPaise(subtotalPaise, rate);
        } else {
            discountPaise = priceToPaise(rawDiscount, true);
            if (discountPaise === null) return { error: "Enter a fixed discount with up to 2 decimals." };
            if (discountPaise > subtotalPaise) return { error: "Fixed discount cannot exceed the subtotal." };
        }
    }
    if (taxRateBps === null) return { error: "Tax rate must be between 0 and 100%." };
    const taxablePaise = subtotalPaise - discountPaise;
    const taxPaise = percentageOfPaise(taxablePaise, taxRateBps);
    if (!Number.isSafeInteger(taxPaise) || !Number.isSafeInteger(taxablePaise + taxPaise)) {
        return { error: "The adjusted total is too large to calculate safely." };
    }
    return {
        type,
        discountValue: type === "none" ? "0" : rawDiscount,
        discountPaise,
        taxRate: get("taxRate").value.trim() || "0",
        taxRateBps,
        taxPaise,
        totalPaise: taxablePaise + taxPaise
    };
}

function percentageOfPaise(amount, basisPoints) {
    return Number((BigInt(amount) * BigInt(basisPoints) + 5000n) / 10000n);
}

function updateTotals() {
    const subtotalPaise = getBillTotal() || 0;
    const adjustments = getAdjustments(subtotalPaise);
    get("subtotal").textContent = formatMoney(subtotalPaise);
    get("discountAmount").textContent = `−${formatMoney(adjustments.discountPaise || 0)}`;
    get("taxAmount").textContent = formatMoney(adjustments.taxPaise || 0);
    get("taxLabel").textContent = `Tax (${get("taxRate").value || "0"}%)`;
    const total = adjustments.error ? subtotalPaise : adjustments.totalPaise;
    get("grandTotal").textContent = formatMoney(total);
    get("dashboardTotal").textContent = formatMoney(total);
    get("productCount").textContent = String(products.length);
    get("emptyItems").hidden = products.length > 0;
    renderStoreDetails(activeReceipt && activeReceipt.storeProfile ? activeReceipt.storeProfile : settings);
}

function renderProducts() {
    const receiptItems = get("receiptItems");
    receiptItems.replaceChildren();
    products.forEach((product, index) => {
        const row = document.createElement("tr");
        [product.name, String(product.quantity), formatMoney(product.pricePaise),
            formatMoney(product.quantity * product.pricePaise)].forEach((value) => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
        });
        const actionCell = document.createElement("td");
        actionCell.className = "screen-only";
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "remove-item-btn";
        removeButton.dataset.index = String(index);
        removeButton.textContent = "Remove";
        removeButton.setAttribute("aria-label", `Remove ${product.name}`);
        actionCell.appendChild(removeButton);
        row.appendChild(actionCell);
        receiptItems.appendChild(row);
    });
    updateTotals();
}

function renderCatalog() {
    const datalist = get("productCatalog");
    datalist.replaceChildren();
    const names = new Set(legacyCatalog);
    inventory.forEach((product) => names.add(product.name));
    receipts.forEach((receipt) => receipt.items.forEach((item) => names.add(item.name)));
    Array.from(names).slice(0, 100).forEach((name) => {
        const option = document.createElement("option");
        option.value = name;
        datalist.appendChild(option);
    });
}

function renderStoreDetails(profile) {
    get("displayStoreName").textContent = profile.storeName || "YOUR STORE";
    get("displayStoreAddress").textContent = profile.address || "";
    get("displayStoreContact").textContent = profile.contact || "";
    get("displayStoreGstin").textContent = profile.gstin ? `GSTIN: ${profile.gstin}` : "";
}

function getReceiptItems(receipt) {
    return Array.isArray(receipt.items) ? receipt.items : [];
}

function renderHistory() {
    const container = get("receiptHistory");
    container.replaceChildren();
    const filtered = getFilteredReceipts();
    get("historyCount").textContent = `${filtered.length} of ${receipts.length} saved`;
    get("historyEmpty").hidden = filtered.length > 0;
    filtered.slice(0, 100).forEach((receipt) => {
        const row = document.createElement("article");
        row.className = "history-row";
        const summary = document.createElement("div");
        summary.className = "history-summary";
        const title = document.createElement("strong");
        title.textContent = receipt.customerName || "Customer";
        const detail = document.createElement("span");
        detail.textContent = `${receipt.id} · ${new Date(receipt.createdAt).toLocaleDateString("en-IN")}`;
        summary.append(title, detail);
        const amount = document.createElement("strong");
        amount.className = "history-amount";
        amount.textContent = formatMoney(Number.isSafeInteger(receipt.totalPaise) ? receipt.totalPaise : 0);
        const actions = document.createElement("div");
        actions.className = "history-actions";
        const viewButton = document.createElement("button");
        viewButton.type = "button";
        viewButton.className = "text-button";
        viewButton.dataset.action = "view";
        viewButton.dataset.id = receipt.id;
        viewButton.textContent = "Open";
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "text-button delete-button";
        deleteButton.dataset.action = "delete";
        deleteButton.dataset.id = receipt.id;
        deleteButton.textContent = "Delete";
        actions.append(viewButton, deleteButton);
        row.append(summary, amount, actions);
        container.appendChild(row);
    });
}

function amountFilterToPaise(value) {
    return value.trim() === "" ? null : priceToPaise(value, true);
}

function getFilteredReceipts() {
    const query = get("historySearch").value.trim().toLocaleLowerCase();
    const from = get("historyFrom").value;
    const to = get("historyTo").value;
    const min = amountFilterToPaise(get("historyMin").value);
    const max = amountFilterToPaise(get("historyMax").value);
    return receipts.filter((receipt) => {
        const searchable = `${receipt.customerName || ""} ${receipt.id || ""}`.toLocaleLowerCase();
        const day = String(receipt.createdAt || "").slice(0, 10);
        const amount = Number.isSafeInteger(receipt.totalPaise) ? receipt.totalPaise : 0;
        return (!query || searchable.includes(query)) && (!from || day >= from) && (!to || day <= to) &&
            (min === null || amount >= min) && (max === null || amount <= max);
    });
}

function renderInventory() {
    const container = get("inventoryList");
    container.replaceChildren();
    get("inventoryCount").textContent = `${inventory.length} product${inventory.length === 1 ? "" : "s"}`;
    get("inventoryEmpty").hidden = inventory.length > 0;
    inventory.forEach((product, index) => {
        const row = document.createElement("div");
        row.className = `inventory-row${product.stock <= product.lowStock ? " low-stock" : ""}`;
        const label = document.createElement("strong");
        label.textContent = product.name;
        const stockLabel = document.createElement("span");
        const isLow = product.stock <= product.lowStock;
        stockLabel.textContent = `${product.stock} in stock · alert at ${product.lowStock}${isLow ? " · LOW STOCK" : ""}`;
        const controls = document.createElement("div");
        controls.className = "inventory-actions";
        const stock = document.createElement("input");
        stock.type = "number";
        stock.min = "0";
        stock.max = "1000000";
        stock.step = "1";
        stock.value = String(product.stock);
        stock.setAttribute("aria-label", `${product.name} stock quantity`);
        const threshold = document.createElement("input");
        threshold.type = "number";
        threshold.min = "0";
        threshold.max = "1000000";
        threshold.step = "1";
        threshold.value = String(product.lowStock);
        threshold.setAttribute("aria-label", `${product.name} low-stock alert`);
        const save = document.createElement("button");
        save.type = "button";
        save.className = "text-button";
        save.dataset.action = "save-inventory";
        save.dataset.index = String(index);
        save.textContent = "Save";
        controls.append(stock, threshold, save);
        row.append(label, stockLabel, controls);
        container.appendChild(row);
    });
}

function getCustomer() {
    const name = get("customerName").value.trim();
    const phone = normalizePhone(get("phone").value);
    if (!name) return { error: "Enter the customer's name." };
    if (!phone) return { error: "Enter a valid Indian mobile number (10 digits, starting 6–9)." };
    return { name, phone };
}

function makeReceiptId() {
    const timestamp = new Date();
    const datePart = timestamp.toISOString().slice(0, 10).replace(/-/g, "");
    const sequence = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8).toUpperCase()
        : `${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    return `REC-${datePart}-${sequence}`;
}

function markReceiptGenerated(receipt) {
    receiptGenerated = true;
    currentReceiptId = receipt.id;
    activeReceipt = receipt;
    get("receiptStatus").textContent = "Saved";
    get("receiptBadge").textContent = "SAVED";
    get("receiptNumber").textContent = receipt.id;
    get("receiptDate").textContent = new Date(receipt.createdAt).toLocaleDateString("en-IN");
    get("displayName").textContent = receipt.customerName;
    get("displayPhone").textContent = receipt.phone;
    get("printReceipt").disabled = false;
    renderStoreDetails(receipt.storeProfile || settings);
}

function inventoryChangeFor(items, multiplier, target) {
    items.forEach((item) => {
        const stocked = target.find((entry) => entry.name.toLocaleLowerCase() === item.name.toLocaleLowerCase());
        if (stocked) stocked.stock += item.quantity * multiplier;
    });
}

function receiptTrackedItems(receipt) {
    if (!Array.isArray(receipt.stockTrackedItemNames)) return [];
    const tracked = new Set(receipt.stockTrackedItemNames.map((name) => String(name).toLocaleLowerCase()));
    return getReceiptItems(receipt).filter((item) => tracked.has(item.name.toLocaleLowerCase()));
}

function validateInventory(nextInventory, oldReceipt, newItems) {
    const available = nextInventory.map((product) => ({
        name: product.name,
        stock: product.stock + (oldReceipt ? receiptTrackedItems(oldReceipt)
            .filter((item) => item.name.toLocaleLowerCase() === product.name.toLocaleLowerCase())
            .reduce((sum, item) => sum + item.quantity, 0) : 0)
    }));
    const requested = new Map();
    newItems.forEach((item) => {
        const match = available.find((product) => product.name.toLocaleLowerCase() === item.name.toLocaleLowerCase());
        if (match) requested.set(match.name.toLocaleLowerCase(), (requested.get(match.name.toLocaleLowerCase()) || 0) + item.quantity);
    });
    for (const [name, quantity] of requested) {
        const stock = available.find((product) => product.name.toLocaleLowerCase() === name);
        if (quantity > stock.stock) return `Not enough stock for ${stock.name}. Available: ${stock.stock}.`;
    }
    return null;
}

function saveReceipt() {
    const customer = getCustomer();
    if (customer.error) {
        showFeedback(customer.error, true);
        get(customer.error.includes("name") ? "customerName" : "phone").focus();
        return;
    }
    if (products.length === 0) {
        showFeedback("Add at least one product before saving this receipt.", true);
        get("productName").focus();
        return;
    }
    const subtotalPaise = getBillTotal();
    if (subtotalPaise === null) {
        showFeedback("The receipt total is too large to calculate safely.", true);
        return;
    }
    const adjustments = getAdjustments(subtotalPaise);
    if (adjustments.error) {
        showFeedback(adjustments.error, true);
        return;
    }
    const existing = receipts.find((receipt) => receipt.id === currentReceiptId);
    const nextInventory = inventory.map((product) => ({ ...product }));
    const stockError = validateInventory(nextInventory, existing, products);
    if (stockError) {
        showFeedback(stockError, true);
        return;
    }
    if (existing) inventoryChangeFor(receiptTrackedItems(existing), 1, nextInventory);
    inventoryChangeFor(products, -1, nextInventory);

    const receipt = {
        id: existing ? existing.id : makeReceiptId(),
        createdAt: existing ? existing.createdAt : new Date().toISOString(),
        customerName: customer.name,
        phone: customer.phone,
        items: products.map((product) => ({ ...product })),
        stockTrackedItemNames: products
            .filter((item) => inventory.some((product) => product.name.toLocaleLowerCase() === item.name.toLocaleLowerCase()))
            .map((item) => item.name),
        subtotalPaise,
        discountType: adjustments.type,
        discountValue: adjustments.discountValue,
        discountPaise: adjustments.discountPaise,
        taxRate: adjustments.taxRate,
        taxPaise: adjustments.taxPaise,
        totalPaise: adjustments.totalPaise,
        storeProfile: { ...settings }
    };
    const nextReceipts = [receipt, ...receipts.filter((item) => item.id !== receipt.id)].slice(0, 100);
    if (!writeStorage(STORAGE_KEYS.inventory, nextInventory)) return;
    if (!writeStorage(STORAGE_KEYS.receipts, nextReceipts)) {
        writeStorage(STORAGE_KEYS.inventory, inventory);
        return;
    }
    inventory = nextInventory;
    receipts = nextReceipts;
    markReceiptGenerated(receipt);
    renderProducts();
    renderInventory();
    renderCatalog();
    renderHistory();
    showFeedback("Receipt saved. Stock and receipt history have been updated.", false);
}

function openReceipt(receipt) {
    products = getReceiptItems(receipt).map((item) => ({ ...item }));
    get("customerName").value = receipt.customerName || "";
    get("phone").value = receipt.phone || "";
    get("discountType").value = receipt.discountType || "none";
    get("discountValue").value = receipt.discountValue || "0";
    get("taxRate").value = receipt.taxRate || "0";
    renderProducts();
    markReceiptGenerated(receipt);
    showFeedback(`Opened ${receipt.id}. Save changes to update this receipt and restore/recheck stock.`, false);
    get("customer").scrollIntoView({ behavior: "smooth", block: "start" });
}

get("addItem").addEventListener("click", () => {
    const name = get("productName").value.trim();
    const quantity = Number(get("quantity").value);
    const pricePaise = priceToPaise(get("price").value, false);
    if (!name || name.length > 100 || !Number.isSafeInteger(quantity) || quantity < 1 ||
        quantity > 1000000 || pricePaise === null) {
        showFeedback("Enter a product, a whole-number quantity, and a price with up to 2 decimals.", true);
        return;
    }
    const existingTotal = getBillTotal();
    if (existingTotal === null || !Number.isSafeInteger(quantity * pricePaise) ||
        !Number.isSafeInteger(existingTotal + quantity * pricePaise)) {
        showFeedback("That item would make the receipt total too large.", true);
        return;
    }
    invalidateReceipt(false);
    activeReceipt = null;
    products.push({ name, quantity, pricePaise });
    renderProducts();
    get("productName").value = "";
    get("quantity").value = "";
    get("price").value = "";
    showFeedback(`${name} added to this receipt.`, false);
    get("productName").focus();
});

get("receiptItems").addEventListener("click", (event) => {
    const button = event.target.closest(".remove-item-btn");
    if (!button) return;
    products.splice(Number(button.dataset.index), 1);
    invalidateReceipt(false);
    activeReceipt = null;
    renderProducts();
    showFeedback("Item removed.", false);
});

["customerName", "phone", "discountType", "discountValue", "taxRate"].forEach((id) => {
    get(id).addEventListener("input", () => {
        invalidateReceipt(false);
        activeReceipt = null;
        get("displayName").textContent = get("customerName").value.trim() || "—";
        get("displayPhone").textContent = get("phone").value.trim() || "—";
        updateTotals();
    });
    get(id).addEventListener("change", updateTotals);
});

get("generateReceipt").addEventListener("click", saveReceipt);

get("receiptHistory").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const receipt = receipts.find((item) => item.id === button.dataset.id);
    if (!receipt) return;
    if (button.dataset.action === "view") {
        openReceipt(receipt);
    } else if (button.dataset.action === "delete" &&
        window.confirm(`Delete receipt ${receipt.id}? Its tracked stock will be restored.`)) {
        const nextInventory = inventory.map((product) => ({ ...product }));
        inventoryChangeFor(receiptTrackedItems(receipt), 1, nextInventory);
        const nextReceipts = receipts.filter((item) => item.id !== receipt.id);
        if (!writeStorage(STORAGE_KEYS.inventory, nextInventory)) return;
        if (!writeStorage(STORAGE_KEYS.receipts, nextReceipts)) {
            writeStorage(STORAGE_KEYS.inventory, inventory);
            return;
        }
        inventory = nextInventory;
        receipts = nextReceipts;
        if (currentReceiptId === receipt.id) {
            invalidateReceipt(true);
            products = [];
            renderProducts();
        }
        renderInventory();
        renderHistory();
        showFeedback("Receipt deleted and tracked stock restored.", false);
    }
});

get("newReceipt").addEventListener("click", () => {
    products = [];
    get("customerName").value = "";
    get("phone").value = "";
    get("productName").value = "";
    get("quantity").value = "";
    get("price").value = "";
    get("discountType").value = "none";
    get("discountValue").value = "0";
    get("taxRate").value = settings.taxRate || "0";
    get("displayName").textContent = "—";
    get("displayPhone").textContent = "—";
    invalidateReceipt(true);
    renderProducts();
    showFeedback("Ready for a new receipt.", false);
    get("customer").scrollIntoView({ behavior: "smooth", block: "start" });
    get("customerName").focus({ preventScroll: true });
});

get("printReceipt").addEventListener("click", () => {
    if (!receiptGenerated) {
        showFeedback("Save the receipt before printing.", true);
        return;
    }
    window.print();
});

get("inventoryForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = get("inventoryName").value.trim();
    const stock = Number(get("inventoryStock").value);
    const lowStock = Number(get("inventoryLowStock").value);
    if (!name || name.length > 100 || !Number.isSafeInteger(stock) || stock < 0 || stock > 1000000 ||
        !Number.isSafeInteger(lowStock) || lowStock < 0 || lowStock > 1000000) return;
    const existing = inventory.find((product) => product.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) {
        showFeedback("That product is already in the catalog. Update its stock below.", true);
        return;
    }
    const nextInventory = [...inventory, { name, stock, lowStock }];
    if (!writeStorage(STORAGE_KEYS.inventory, nextInventory)) return;
    inventory = nextInventory;
    get("inventoryForm").reset();
    get("inventoryStock").value = "0";
    get("inventoryLowStock").value = "5";
    renderInventory();
    renderCatalog();
    showFeedback(`${name} added to inventory.`, false);
});

get("inventoryList").addEventListener("click", (event) => {
    const button = event.target.closest('button[data-action="save-inventory"]');
    if (!button) return;
    const index = Number(button.dataset.index);
    const row = button.closest(".inventory-row");
    const stock = Number(row.querySelector('[aria-label$="stock quantity"]').value);
    const lowStock = Number(row.querySelector('[aria-label$="low-stock alert"]').value);
    if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1000000 ||
        !Number.isSafeInteger(lowStock) || lowStock < 0 || lowStock > 1000000) {
        showFeedback("Stock and low-stock threshold must be whole numbers from 0 to 1,000,000.", true);
        return;
    }
    const nextInventory = inventory.map((product) => ({ ...product }));
    nextInventory[index].stock = stock;
    nextInventory[index].lowStock = lowStock;
    if (!writeStorage(STORAGE_KEYS.inventory, nextInventory)) return;
    inventory = nextInventory;
    renderInventory();
    showFeedback(`${nextInventory[index].name} stock updated.`, false);
});

function csvEscape(value) {
    let text = String(value == null ? "" : value);
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

get("exportCsv").addEventListener("click", () => {
    const headers = ["Receipt ID", "Date", "Customer", "Mobile", "Subtotal (INR)", "Discount (INR)", "Tax rate (%)", "Tax (INR)", "Total (INR)", "Items"];
    const rows = getFilteredReceipts().map((receipt) => [
        receipt.id, receipt.createdAt, receipt.customerName, receipt.phone,
        paiseToDecimal(receipt.subtotalPaise === undefined ? receipt.totalPaise : receipt.subtotalPaise),
        paiseToDecimal(receipt.discountPaise || 0), receipt.taxRate || "0",
        paiseToDecimal(receipt.taxPaise || 0), paiseToDecimal(receipt.totalPaise),
        getReceiptItems(receipt).map((item) => `${item.name} x${item.quantity}`).join("; ")
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "quickbill-receipts.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
});

["historySearch", "historyFrom", "historyTo", "historyMin", "historyMax"].forEach((id) => {
    get(id).addEventListener("input", renderHistory);
    get(id).addEventListener("change", renderHistory);
});

get("settingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const taxRate = get("defaultTaxRate").value.trim() || "0";
    if (parseRate(taxRate) === null) {
        showFeedback("Default tax rate must be between 0 and 100%.", true);
        get("defaultTaxRate").focus();
        return;
    }
    settings = {
        storeName: get("storeName").value.trim(),
        address: get("storeAddress").value.trim(),
        contact: get("storeContact").value.trim(),
        gstin: get("storeGstin").value.trim(),
        taxRate
    };
    if (!writeStorage(STORAGE_KEYS.settings, settings)) return;
    if (!get("taxRate").value || get("taxRate").value === "0") get("taxRate").value = settings.taxRate;
    if (!receiptGenerated) activeReceipt = null;
    updateTotals();
    showFeedback("Store profile saved. Future receipts will use this profile and default tax rate.", false);
});

function initialize() {
    get("storeName").value = settings.storeName;
    get("storeAddress").value = settings.address;
    get("storeContact").value = settings.contact;
    get("storeGstin").value = settings.gstin;
    get("defaultTaxRate").value = settings.taxRate || "0";
    get("taxRate").value = settings.taxRate || "0";
    const normalizedInventory = inventory.map((product) => ({
        name: product.name,
        stock: product.stock,
        lowStock: Number.isSafeInteger(product.lowStock) && product.lowStock >= 0 ? product.lowStock : 5
    }));
    inventory = normalizedInventory;
    syncInitialCatalog();
    renderCatalog();
    renderProducts();
    renderInventory();
    renderHistory();
}

get("signOut").addEventListener("click", () => {
    sessionStorage.removeItem(DEMO_SESSION_KEY);
    window.location.replace("login.html");
});

function syncInitialCatalog() {
    const names = new Set(inventory.map((product) => product.name.toLocaleLowerCase()));
    receipts.forEach((receipt) => getReceiptItems(receipt).forEach((item) => {
        if (item && typeof item.name === "string" && !names.has(item.name.toLocaleLowerCase())) {
            names.add(item.name.toLocaleLowerCase());
            legacyCatalog.push(item.name);
        }
    }));
    legacyCatalog = Array.from(new Set(legacyCatalog)).slice(0, 100);
    writeStorage(STORAGE_KEYS.products, legacyCatalog);
    if (localStorage.getItem(STORAGE_KEYS.inventory) === null) writeStorage(STORAGE_KEYS.inventory, inventory);
}

initialize();
