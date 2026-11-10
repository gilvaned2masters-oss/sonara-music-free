# Sonara Music — Guia de Implementação (passo a passo)

Este é o sistema **automático** de música personalizada por PIX:
cliente paga → IA gera a letra → gerador cria a música → áudio é guardado
permanentemente → cliente recebe por **email + WhatsApp** + área do cliente.
Mais recuperação de PIX (carrinho abandonado) e programa de indicação.

Roda 100% em **Cloudflare Pages + Functions** (serverless). Sem servidor próprio
obrigatório — só o WhatsApp automático precisa de uma VPS (opcional, ver §9).

> ⚠️ Este pacote **não contém nenhuma chave/secret**. Todas as chaves você
> coloca você mesmo no painel da Cloudflare (§5). O `.env.example` lista cada
> uma e onde conseguir.

---

## 1. Visão geral da arquitetura

```
              ┌─────────────────────────────────────────────┐
   Cliente ──▶│  public/  (site estático: landing, /pronto,  │
              │            /conta, /indique, admin)          │
              └───────────────┬─────────────────────────────┘
                              │ chama
              ┌───────────────▼─────────────────────────────┐
              │  functions/  (API serverless — Cloudflare)   │
              │                                              │
   PIX  ◀────▶│  create-payment → kiwify-pix-webhook         │
              │  generate-lyrics (OpenAI) → gera a letra     │
   Música◀───▶│  auto-status / kie-callback (KIE/Sunor)      │
              │  fix-kie-audio → guarda MP3 no R2            │
   Entrega◀──▶│  delivery-recovery (email + WhatsApp)        │
   Recup. ◀──▶│  pix-recovery (3 emails de carrinho)         │
              └──────┬──────────────────┬────────────────────┘
                     │                  │
              ┌──────▼──────┐    ┌──────▼──────┐
              │  ORDERS_KV  │    │ AUDIO_BUCKET│
              │  (pedidos)  │    │   (R2 mp3)  │
              └─────────────┘    └─────────────┘
```

**Fluxo de pagamento (fallback em cascata):**
1. **Kiwify Conta** — PIX principal, taxa zero
2. **Asaas** — fallback se Kiwify falhar
3. **Mercado Pago** — fallback 2

**Gerador de música (fallback):**
1. **Sunor** — principal
2. **KIE.ai** — fallback (atualmente o **ativo**, modelo **V5**)

---

## 2. Pré-requisitos (contas que você precisa criar)

| Serviço | Para quê | Obrigatório? |
|---|---|---|
| **Cloudflare** | Hospedagem (Pages + KV + R2) | ✅ Sim |
| **KIE.ai** | Gerar a música (gerador ativo) | ✅ Sim (ou Sunor) |
| **Sunor** | Gerar a música (principal) | Opcional |
| **OpenAI** | Gerar a letra (gpt-4o-mini) | ✅ Sim |
| **Kiwify** | Receber PIX (taxa zero) | ✅ Sim (ou Asaas/MP) |
| **Asaas** | PIX fallback | Opcional |
| **Mercado Pago** | PIX fallback 2 | Opcional |
| **Resend** | Enviar emails | ✅ Sim |
| **Meta (Facebook)** | Pixel + Conversions API (ads) | Opcional |
| **VPS (Contabo/Hetzner/etc.)** | WhatsApp automático (Evolution) | Opcional |
| **Domínio próprio** | Ex.: seudominio.com | ✅ Recomendado |

---

## 3. Subir o código no seu Git

1. Crie um repositório novo (GitHub/GitLab).
2. Jogue o conteúdo deste ZIP na raiz do repo.
3. Commit + push:
   ```bash
   git init
   git add .
   git commit -m "init sonara music"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git
   git push -u origin main
   ```

---

## 4. Criar o projeto na Cloudflare Pages

1. Painel Cloudflare → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** → escolha o repo.
2. Configurações de build:
   - **Framework preset:** `None`
   - **Build command:** *(deixe vazio)*
   - **Build output directory:** `public`
3. Salve e faça o primeiro deploy.
4. Anote o nome do projeto (ex.: `sonara-music`). Coloque-o no `wrangler.toml`
   no campo `name`.

> O deploy é **automático**: todo `git push` na branch `main` republica o site.

---

## 5. Variáveis de ambiente (SECRETS)

Painel → seu projeto Pages → **Settings** → **Variables and Secrets** →
ambiente **Production** → adicione cada variável abaixo como tipo **Secret**.

Use o arquivo [`.env.example`](.env.example) como checklist. Resumo do que é cada uma:

| Variável | O que é / onde conseguir |
|---|---|
| `KIE_API_KEY` | kie.ai → API Keys (Bearer) |
| `SUNOR_API_KEY` | sunor.cc → API (x-api-key) |
| `OPENAI_API_KEY` | platform.openai.com → API keys |
| `ANTHROPIC_API_KEY` | console.anthropic.com (opcional) |
| `KIWIFY_ACCESS_ID` | Kiwify Conta → integração PIX (Access ID) |
| `KIWIFY_PRIVATE_KEY_HEX` | Kiwify → chave privada Ed25519 em HEX |
| `ASAAS_API_KEY` | Asaas → Integrações → API (opcional) |
| `MERCADO_PAGO_ACCESS_TOKEN` | MP → Suas integrações (opcional) |
| `RESEND_API_KEY` | resend.com → API Keys |
| `FROM_EMAIL` | remetente verificado no Resend (ex.: `noreply@seudominio.com`) |
| `META_PIXEL_ID` | Gerenciador de Eventos Meta (opcional) |
| `META_CAPI_TOKEN` | Meta → Conversions API token (opcional) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | gere com `npx web-push generate-vapid-keys` |
| `ADMIN_PASSWORD` | **você inventa** — senha do painel `/admin` |
| `CRON_SECRET` | **você inventa** — string aleatória forte (protege os crons) |
| `OWNER_WHATSAPP` | seu número de suporte (aparece nos emails), ex.: `5541999999999` |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` / `EVOLUTION_INSTANCE` | só se usar WhatsApp automático (§9) |

> 🚨 **NUNCA** use "editar todas as variáveis de uma vez" / PATCH em massa.
> Isso zera os valores `secret` que você não reenviar. Edite **uma de cada vez**.

---

## 6. Criar o KV namespace e o bucket R2

### KV (banco dos pedidos)
1. Painel → **Workers & Pages** → **KV** → **Create namespace** (ex.: `orders`).
2. Copie o **ID** gerado.
3. Cole no `wrangler.toml` em `id = "..."` (binding `ORDERS_KV`).
4. Vá em seu projeto Pages → **Settings** → **Functions** → **KV namespace
   bindings** → adicione: variável `ORDERS_KV` → o namespace que criou.

### R2 (áudios permanentes)
1. Painel → **R2** → **Create bucket** (ex.: `sonara-audio`).
2. Cole o nome no `wrangler.toml` em `bucket_name = "..."` (binding `AUDIO_BUCKET`).
3. Projeto Pages → **Settings** → **Functions** → **R2 bucket bindings** →
   variável `AUDIO_BUCKET` → o bucket.

> **Por que R2?** As URLs que a KIE/Sunor devolvem (`musicfile.kie.ai`)
> **expiram** e viram arquivo de 0 bytes. O sistema baixa o MP3 e guarda
> permanentemente no R2, servindo via `/audio/[id]`. Sem isso, o cliente
> perde o acesso à música depois de algumas horas.

Depois de criar os bindings, faça um novo deploy (push qualquer) pra eles valerem.

---

## 7. Webhooks dos pagamentos

Configure cada gateway pra chamar de volta o seu domínio quando o PIX for pago:

| Gateway | URL do webhook |
|---|---|
| Kiwify | `https://SEU-DOMINIO/kiwify-pix-webhook` |
| Asaas | `https://SEU-DOMINIO/asaas-webhook` |
| Mercado Pago | `https://SEU-DOMINIO/mp-webhook` |

E o **callback do gerador**:
- KIE.ai callback → `https://SEU-DOMINIO/kie-callback`

---

## 8. Crons (recuperação automática)

Há 2 robôs agendados via **GitHub Actions** (já incluídos em
`.github/workflows/`):

| Workflow | O que faz | Frequência |
|---|---|---|
| `delivery-recovery-cron.yml` | Reenvia música pronta pra quem fechou a página antes do email sair | a cada 1 min |
| `pix-recovery-cron.yml` | Manda os 3 emails de carrinho abandonado (PIX gerado, não pago) | a cada 30 min |

**Para ativar:** no seu repositório GitHub → **Settings** → **Secrets and
variables** → **Actions** → adicione:
- `CRON_SECRET` = o mesmo valor que pôs na Cloudflare
- `SITE_URL` = `https://SEU-DOMINIO` (sem barra no fim)

> Os crons chamam `/delivery-recovery?secret=...` e `/pix-recovery?secret=...`.
> Sem o `CRON_SECRET` certo, a Cloudflare devolve 401 (proteção).

### ⚠️ Recuperação de PIX: prefira a VPS (disparo pontual)

O GitHub Actions é ótimo pra começar (zero infra), **mas atrasa**: crons
agendados no plano grátis entram numa fila e podem rodar 10 min a **1–3h**
depois do horário — às vezes pulam execuções. Para **recuperação de PIX**, que
depende de disparar ~30 min após o abandono, esse atraso derruba a conversão.

Se você já tem uma VPS (a mesma do WhatsApp, §9), mova o disparo pra lá — cron
de Linux é **pontual ao minuto**:

```bash
crontab -e
# adicione (a cada 5 min é suficiente — o endpoint decide quem está na hora):
*/5 * * * * /usr/bin/curl -s "https://SEU-DOMINIO/pix-recovery?secret=SEU_CRON_SECRET" >/dev/null 2>&1
```

Com isso o 1º email sai ~30–35 min após o abandono. Pode **desativar** o
workflow `pix-recovery-cron.yml` no GitHub (ou deixá-lo como backup — o endpoint
é idempotente, não manda email repetido).

**Cadência da sequência** (em `functions/pix-recovery.ts`): 1º email 30 min após
gerar o PIX · 2º +4h (mesmo dia) · 3º +20h (dia seguinte) · corte em 96h. Cada
email gera um **PIX novo e válido** (códigos expiram), então não há trava de
expiração. Ajuste os tempos nas constantes `STAGE1_AFTER` / `STAGE2_AFTER` /
`STAGE3_AFTER` se quiser.

> **Disparo manual em massa** (ex.: mandar o 2º email a todos os pendentes das
> últimas 48h de uma vez): `…/pix-recovery?secret=SECRET&forceStage=2&sinceHours=48`.
> Pula quem já recebeu aquele estágio (sem repetição).

---

## 9. WhatsApp automático (OPCIONAL — precisa de VPS)

Se quiser que o cliente receba a música também no WhatsApp, suba a **Evolution
API** numa VPS. Tudo o que precisa está na pasta `evolution/`
(docker-compose + Caddy). Resumo:

1. VPS Linux (Contabo/Hetzner) com Docker + Docker Compose.
2. Aponte um subdomínio (ex.: `evo.seudominio.com`) pro IP da VPS.
3. Edite o `evolution/docker-compose.yml` (senha, `AUTHENTICATION_API_KEY`) e
   o `Caddyfile` (seu subdomínio).
4. `docker compose up -d` → acesse o manager → crie uma **instância** →
   leia o QR no seu WhatsApp.
5. Na Cloudflare, preencha `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`,
   `EVOLUTION_INSTANCE`.

> Se deixar essas 3 variáveis vazias, o sistema simplesmente **pula** o
> WhatsApp e entrega só por email. Tudo continua funcionando.

### ⚠️ TRAVA ANTI-SPAM (leia antes de ligar o WhatsApp)
No arquivo `functions/delivery-recovery.ts` existe:
```ts
const WHATSAPP_CUTOFF_MS = 1782053765474;
```
Isso garante que **só pedidos criados depois desse instante** recebem WhatsApp.
**Troque esse número pelo timestamp do seu "go-live"** (data/hora em que você
ligou o WhatsApp), em milissegundos. Pegue em https://currentmillis.com.

Isso impede que o robô dispare WhatsApp em massa pra todos os pedidos antigos
do banco de uma vez. **Não remova essa trava.**

---

## 10. Personalização (find-replace antes de publicar)

Procure e substitua em todo o projeto (a marca antiga é "Sonara/sonaramusic"):

| Procurar | Trocar por |
|---|---|
| `sonaramusic.pro` | seu domínio |
| `5541988623254` | seu WhatsApp (formato internacional, sem +) |
| `4090193661124064` | seu `META_PIXEL_ID` (se usar Meta) |
| `noreply@sonaramusic.pro` | seu `FROM_EMAIL` |
| Nome "Sonara Music" | nome da sua marca (textos/emails) |

Dica: no VS Code, busca global (Ctrl+Shift+F) por `sonaramusic.pro` mostra
todos os lugares.

E **resete** o `WHATSAPP_CUTOFF_MS` (§9).

---

## 11. Painel admin

Acesse `https://SEU-DOMINIO/admin`. Login com `ADMIN_PASSWORD`.
Mostra pedidos, faturamento, status de produção e botões de reenvio/correção.

---

## 12. Checklist final

- [ ] Repo no Git + push
- [ ] Projeto Pages criado (output `public`)
- [ ] Todas as secrets do §5 cadastradas (uma a uma)
- [ ] KV `ORDERS_KV` criado + binding
- [ ] R2 `AUDIO_BUCKET` criado + binding
- [ ] `wrangler.toml` com nome do projeto, ID do KV e nome do bucket
- [ ] Webhooks dos gateways apontando pro domínio (§7)
- [ ] Callback KIE apontando pro domínio
- [ ] GitHub Actions: secrets `CRON_SECRET` + `SITE_URL`
- [ ] Find-replace de domínio/WhatsApp/pixel (§10)
- [ ] `WHATSAPP_CUTOFF_MS` resetado pro seu go-live (se usar WhatsApp)
- [ ] Resend: domínio verificado pro `FROM_EMAIL`
- [ ] Teste: gerar um pedido de ponta a ponta (letra → música → R2 → email)

---

## 13. Armadilhas importantes (não pule)

1. **Nunca edite todas as env vars de uma vez** na Cloudflare — zera os secrets.
2. **R2 é obrigatório** — sem ele a música expira e o cliente fica sem o áudio.
3. **`CRON_SECRET` igual** nos dois lados (Cloudflare e GitHub Actions).
4. **`WHATSAPP_CUTOFF_MS`** sempre resetado antes de ligar o WhatsApp.
5. **QR do PIX nos emails** usa URL hospedada (`api.qrserver.com`) — não use
   base64/data-URI: o Gmail bloqueia e corta o email.
6. **Verifique o domínio no Resend** antes de mandar email em produção, senão
   cai em spam ou nem sai.
7. **Modelo KIE = V5** (em `functions/_shared/treblo-helpers.ts`). Se a KIE
   mudar de versão, ajuste ali.
