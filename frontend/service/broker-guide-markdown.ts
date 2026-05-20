import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BrokerCode } from "@/service/types/broker";

export async function getBrokerGuideMarkdown(broker: BrokerCode): Promise<string> {
    const filePath = path.join(process.cwd(), "content", "broker-guides", `${broker}.md`);
    return readFile(filePath, "utf8");
}
