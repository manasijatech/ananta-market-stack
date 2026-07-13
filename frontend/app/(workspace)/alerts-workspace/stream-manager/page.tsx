import { redirect } from "next/navigation";

export default async function StreamManagerPage() {
    redirect("/settings#stream-manager");
}
