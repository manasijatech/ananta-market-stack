export type DeploymentUpdateStatus = {
    checks_enabled: boolean;
    update_available: boolean;
    running_version: string | null;
    running_sha: string | null;
    running_digest: string | null;
    latest_digest: string | null;
    image_repository: string;
    image_tag: string;
    last_checked_at: string | null;
    last_check_error: string | null;
    docker_image_update_docs_url: string;
    self_hosting_update_docs_url: string;
};
