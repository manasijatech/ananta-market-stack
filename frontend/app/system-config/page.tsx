import { redirect } from "next/navigation";

export default async function SystemConfigPage() {
    redirect("/settings");
}
