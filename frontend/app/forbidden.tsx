import { AccessDeniedState } from "@/components/access/access-denied-state";

export default function ForbiddenPage() {
    return (
        <AccessDeniedState
            title="Access not allowed"
            description="This page is restricted for your current workspace role."
            reason="Use the back action below, or ask a workspace admin to grant the missing access."
            backHref="/broker-connections"
        />
    );
}
