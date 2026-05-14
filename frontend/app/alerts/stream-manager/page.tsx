import { StreamManager } from "@/components/alerts/stream-manager";
import { getLiveStreamsStatus } from "@/service/actions/alerts";

export default async function StreamManagerPage() {
 const status = await getLiveStreamsStatus();

 return (
 <StreamManager initialStatus={status} />
 );
}
