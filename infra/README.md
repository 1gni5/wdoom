# Azure deployment (Terraform, local state)

Creates: storage account static website (game files + generated `config.js`)
and a single-replica Container App running the relay (`SERVE_STATIC=0`,
`ALLOWED_ORIGINS` = the static site).

    npm run build            # produces web/dist (uploaded by terraform)
    cd infra
    az login
    terraform init
    terraform apply -var subscription_id=<id>

Outputs `game_url` and `relay_url`. The relay image defaults to
`ghcr.io/1gni5/wdoom:latest` (make the GHCR package public). Re-run `apply`
after a rebuild to re-upload changed files. State is a local `terraform.tfstate`
(git-ignored) — keep it.
