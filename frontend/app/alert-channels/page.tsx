import { redirect } from "next/navigation";

export default async function AlertChannelsPage() {
    redirect("/settings#alert-channels");
}
