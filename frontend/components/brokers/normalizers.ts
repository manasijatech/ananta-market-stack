import type { FundsResponse, Holding, JsonObject, JsonValue, Order, Position, Profile, Trade } from "@/service/types/broker";

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: JsonValue | undefined): JsonObject {
  return isObject(value) ? value : {};
}

function asArray(value: JsonValue | undefined): JsonObject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is JsonObject => isObject(item));
}

function stringFrom(row: JsonObject, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
  return fallback;
}

function numberFrom(row: JsonObject, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function firstArray(payload: JsonObject, keys: string[]): JsonObject[] {
  for (const key of keys) {
    const direct = asArray(payload[key]);
    if (direct.length) {
      return direct;
    }
    const nested = asObject(payload.data);
    const nestedRows = asArray(nested[key]);
    if (nestedRows.length) {
      return nestedRows;
    }
    const payloadObject = asObject(payload.payload);
    const payloadRows = asArray(payloadObject[key]);
    if (payloadRows.length) {
      return payloadRows;
    }
  }
  const dataRows = asArray(payload.data);
  if (dataRows.length) {
    return dataRows;
  }
  const payloadRows = asArray(payload.payload);
  if (payloadRows.length) {
    return payloadRows;
  }
  return [];
}

export function normalizeOrders(payload: JsonObject): Order[] {
  return firstArray(payload, ["orders", "order_list", "data"]).map((row, index) => ({
    id: stringFrom(row, ["order_id", "orderid", "orderId", "id"], `order-${index}`),
    symbol: stringFrom(row, ["tradingsymbol", "trading_symbol", "symbol", "securityId"], "Unknown"),
    action: stringFrom(row, ["transaction_type", "transactionType", "action", "side"], "-"),
    quantity: numberFrom(row, ["quantity", "qty", "filled_quantity"]) ?? 0,
    price: numberFrom(row, ["price", "average_price", "avgPrice"]),
    status: stringFrom(row, ["status", "order_status", "orderStatus"], "unknown"),
    time: stringFrom(row, ["order_timestamp", "exchange_timestamp", "created_at", "time"], "") || null,
    raw: row
  }));
}

export function normalizeTrades(payload: JsonObject): Trade[] {
  return firstArray(payload, ["trades", "trade_list", "data"]).map((row, index) => ({
    id: stringFrom(row, ["trade_id", "tradeid", "order_id", "id"], `trade-${index}`),
    symbol: stringFrom(row, ["tradingsymbol", "trading_symbol", "symbol", "securityId"], "Unknown"),
    action: stringFrom(row, ["transaction_type", "transactionType", "action", "side"], "-"),
    quantity: numberFrom(row, ["quantity", "qty", "filled_quantity"]) ?? 0,
    avg_price: numberFrom(row, ["average_price", "avg_price", "avgPrice", "price"]),
    time: stringFrom(row, ["trade_timestamp", "exchange_timestamp", "created_at", "time"], "") || null,
    raw: row
  }));
}

export function normalizePositions(payload: JsonObject): Position[] {
  const rows = firstArray(payload, ["positions", "net", "data"]);
  return rows.map((row, index) => ({
    id: stringFrom(row, ["tradingsymbol", "trading_symbol", "symbol", "securityId"], `position-${index}`),
    symbol: stringFrom(row, ["tradingsymbol", "trading_symbol", "symbol", "securityId"], "Unknown"),
    product: stringFrom(row, ["product", "producttype", "productType"], "") || null,
    quantity: numberFrom(row, ["quantity", "netqty", "net_qty", "netQuantity"]) ?? 0,
    pnl: numberFrom(row, ["pnl", "profit_and_loss", "profitAndLoss", "day_pnl"]),
    raw: row
  }));
}

export function normalizeHoldings(payload: JsonObject): Holding[] {
  return firstArray(payload, ["holdings", "holding", "data"]).map((row, index) => ({
    id: stringFrom(row, ["tradingsymbol", "trading_symbol", "symbol", "isin"], `holding-${index}`),
    symbol: stringFrom(row, ["tradingsymbol", "trading_symbol", "symbol", "isin"], "Unknown"),
    quantity: numberFrom(row, ["quantity", "qty", "holdingQty"]) ?? 0,
    average_price: numberFrom(row, ["average_price", "avg_price", "averagePrice"]),
    last_price: numberFrom(row, ["last_price", "ltp", "lastPrice"]),
    pnl: numberFrom(row, ["pnl", "profit_and_loss", "profitAndLoss"]),
    pnl_percent: numberFrom(row, ["pnl_percent", "pnlPercentage", "day_change_percentage"]),
    raw: row
  }));
}

export function normalizeFunds(payload: JsonObject): FundsResponse {
  const data = asObject(payload.data);
  const payloadObject = asObject(payload.payload);
  const equity = asObject(data.equity);
  const source = Object.keys(equity).length
    ? equity
    : Object.keys(payloadObject).length
      ? payloadObject
      : Object.keys(data).length
        ? data
        : payload;
  const clearCash = numberFrom(source, ["clear_cash"]);
  const collateralAvailable = numberFrom(source, ["collateral_available"]);
  const computedAvailable = clearCash !== null || collateralAvailable !== null
    ? (clearCash ?? 0) + (collateralAvailable ?? 0)
    : null;
  const used = numberFrom(source, ["used", "utilised", "used_margin", "margin_used", "net_margin_used"]);
  return {
    available: numberFrom(source, ["available", "available_margin", "availablecash", "net", "cash"]) ?? computedAvailable,
    used,
    opening_balance: numberFrom(source, ["opening_balance", "openingBalance", "opening"]),
    total: numberFrom(source, ["total", "total_margin", "net", "equity"]) ?? (computedAvailable !== null ? computedAvailable + (used ?? 0) : null),
    raw: payload
  };
}

export function normalizeProfile(payload: JsonObject): Profile {
  const data = asObject(payload.data);
  const payloadObject = asObject(payload.payload);
  const source = Object.keys(data).length
    ? data
    : Object.keys(payloadObject).length
      ? payloadObject
      : payload;
  return {
    name: stringFrom(source, ["user_name", "userName", "name", "clientName"], "") || null,
    email: stringFrom(source, ["email", "email_id", "emailId"], "") || null,
    broker_user_id: stringFrom(
      source,
      ["user_id", "userId", "client_id", "clientId", "vendor_user_id", "ucc"],
      ""
    ) || null,
    raw: payload
  };
}
