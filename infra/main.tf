terraform {
  required_version = ">= 1.5"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

variable "subscription_id" {
  type        = string
  description = "Azure subscription ID"
}

variable "location" {
  type    = string
  default = "westeurope"
}

variable "name" {
  type    = string
  default = "webdoom"
}

variable "relay_image" {
  type        = string
  default     = "ghcr.io/1gni5/wdoom:latest"
  description = "Relay image (must be public, or add registry credentials)"
}

resource "random_string" "suffix" {
  length  = 6
  upper   = false
  special = false
}

resource "azurerm_resource_group" "rg" {
  name     = "rg-${var.name}"
  location = var.location
}

# ---- Static hosting (game files) -------------------------------------------

resource "azurerm_storage_account" "web" {
  name                     = "${var.name}${random_string.suffix.result}"
  resource_group_name      = azurerm_resource_group.rg.name
  location                 = azurerm_resource_group.rg.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_storage_account_static_website" "web" {
  storage_account_id = azurerm_storage_account.web.id
  index_document     = "index.html"
  error_404_document = "index.html"
}

locals {
  web_dir = "${path.module}/../web"
  # config.js is generated below (points at the relay), so skip the local one.
  web_files = toset([for f in fileset(local.web_dir, "**") : f if f != "config.js"])
  content_types = {
    html = "text/html; charset=utf-8"
    js   = "text/javascript; charset=utf-8"
    css  = "text/css; charset=utf-8"
    json = "application/json; charset=utf-8"
    wasm = "application/wasm"
    png  = "image/png"
    svg  = "image/svg+xml"
    ico  = "image/x-icon"
  }
}

resource "azurerm_storage_blob" "web" {
  for_each               = local.web_files
  name                   = each.value
  storage_account_name   = azurerm_storage_account.web.name
  storage_container_name = "$web"
  type                   = "Block"
  source                 = "${local.web_dir}/${each.value}"
  content_md5            = filemd5("${local.web_dir}/${each.value}")
  content_type           = lookup(local.content_types, reverse(split(".", each.value))[0], "application/octet-stream")
  depends_on             = [azurerm_storage_account_static_website.web]
}

resource "azurerm_storage_blob" "config" {
  name                   = "config.js"
  storage_account_name   = azurerm_storage_account.web.name
  storage_container_name = "$web"
  type                   = "Block"
  content_type           = "text/javascript; charset=utf-8"
  source_content         = "globalThis.DOOM_CONFIG = { relayUrl: \"wss://${azurerm_container_app.relay.ingress[0].fqdn}/ws\" };\n"
  depends_on             = [azurerm_storage_account_static_website.web]
}

# ---- Relay (Container App) ---------------------------------------------------

resource "azurerm_log_analytics_workspace" "logs" {
  name                = "log-${var.name}"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

resource "azurerm_container_app_environment" "env" {
  name                       = "cae-${var.name}"
  resource_group_name        = azurerm_resource_group.rg.name
  location                   = azurerm_resource_group.rg.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.logs.id
}

resource "azurerm_container_app" "relay" {
  name                         = "ca-${var.name}-relay"
  resource_group_name          = azurerm_resource_group.rg.name
  container_app_environment_id = azurerm_container_app_environment.env.id
  revision_mode                = "Single"

  template {
    # Rooms live in memory: exactly one replica.
    min_replicas = 1
    max_replicas = 1

    container {
      name   = "relay"
      image  = var.relay_image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "SERVE_STATIC"
        value = "0"
      }
      env {
        name  = "ALLOWED_ORIGINS"
        value = trimsuffix(azurerm_storage_account.web.primary_web_endpoint, "/")
      }

      liveness_probe {
        transport = "HTTP"
        path      = "/healthz"
        port      = 8081
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 8081
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
}

output "game_url" {
  value = azurerm_storage_account.web.primary_web_endpoint
}

output "relay_url" {
  value = "wss://${azurerm_container_app.relay.ingress[0].fqdn}/ws"
}
