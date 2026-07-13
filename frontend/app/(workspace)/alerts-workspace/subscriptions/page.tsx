import { redirect } from "next/navigation";

export default async function AlertSubscriptionsPage() {
    redirect("/settings#live-subscriptions");
}
