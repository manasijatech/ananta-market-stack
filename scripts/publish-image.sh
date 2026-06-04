#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/publish-image.sh VERSION [IMAGE]

Examples:
  scripts/publish-image.sh 0.1.0 ghcr.io/your-github-user/ananta-market-stack
  IMAGE=ghcr.io/your-github-user/ananta-market-stack scripts/publish-image.sh 0.1.0
  PUBLISH_LATEST=true scripts/publish-image.sh 0.1.0 ghcr.io/your-github-user/ananta-market-stack

Before running:
  echo "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
EOF
}

version="${1:-}"
image="${2:-${IMAGE:-}}"
publish_latest="${PUBLISH_LATEST:-false}"

if [[ -z "$version" || "$version" == "-h" || "$version" == "--help" ]]; then
  usage
  exit 1
fi

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must use MAJOR.MINOR.PATCH format, for example 0.1.0." >&2
  exit 1
fi

if [[ -z "$image" ]]; then
  echo "Image is required. Pass it as the second argument or set IMAGE." >&2
  usage
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

minor="${version%.*}"
major="${version%%.*}"
sha_tag="sha-$(git rev-parse --short HEAD 2>/dev/null || echo local)"
local_tag="ananta-market-stack:publish-${version}"
container_name="ananta-market-stack-publish-smoke"
volume_name="ananta-market-stack-publish-smoke-data"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  docker volume rm "$volume_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Building $local_tag"
docker build -t "$local_tag" .

echo "Smoke testing $local_tag"
cleanup
docker run -d --rm --name "$container_name" -p 3100:3000 -v "$volume_name:/data" "$local_tag" >/dev/null
for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:3100 >/dev/null && curl -fsS http://127.0.0.1:3100/api/v1/brokers/supported >/dev/null; then
    break
  fi
  sleep 2
done

if ! curl -fsS http://127.0.0.1:3100/api/v1/brokers/supported >/dev/null; then
  docker logs "$container_name"
  echo "Smoke test failed." >&2
  exit 1
fi
cleanup

tags=(
  "$image:$version"
  "$image:$minor"
  "$image:$major"
  "$image:$sha_tag"
)

if [[ "$publish_latest" == "true" ]]; then
  tags+=("$image:latest")
fi

for tag in "${tags[@]}"; do
  echo "Tagging $tag"
  docker tag "$local_tag" "$tag"
done

for tag in "${tags[@]}"; do
  echo "Pushing $tag"
  docker push "$tag"
done

echo "Published:"
printf '  %s\n' "${tags[@]}"
