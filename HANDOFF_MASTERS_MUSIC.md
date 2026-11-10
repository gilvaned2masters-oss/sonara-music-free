# Masters Music - Handoff Operacional

Este arquivo existe para permitir continuidade em outro computador ou em outra sessao do Codex. Ele documenta a estrutura, os servicos conectados e os procedimentos de manutencao sem expor senhas, tokens ou chaves privadas.

## Resumo

- Marca publica: Masters Music
- Dominio principal: https://mastersmusic.com.br
- Cloudflare Pages project: `music`
- Pages output: `public`
- Functions: `functions`
- KV principal: `ORDERS_KV`
- KV namespace id: `1e913380853c44e9a7d0ffca3f7cd58f`
- R2 audio bucket: `sonara-audio`
- WhatsApp suporte: `+55 41 8886-9695`
- Numero Evolution conectado: `554188869695`
- Evolution instance: `AudiosClientes`

## Repositorios

- Desenvolvimento/origem: `https://github.com/owennd2/masters-music.git`
- Producao/backup usado neste handoff: `https://github.com/owennd2/music.git`

Comandos uteis:

```powershell
git clone https://github.com/owennd2/masters-music.git
cd masters-music
git remote -v
```

Neste computador, os remotes estavam assim:

```text
origin     https://github.com/owennd2/masters-music.git
production https://github.com/owennd2/music.git
```

## Cloudflare

Arquivo de configuracao:

```text
wrangler.toml
```

Conteudo importante:

```toml
name = "music"
compatibility_date = "2024-09-23"
pages_build_output_dir = "public"

[[kv_namespaces]]
binding = "ORDERS_KV"
id = "1e913380853c44e9a7d0ffca3f7cd58f"

[[r2_buckets]]
binding = "AUDIO_BUCKET"
bucket_name = "sonara-audio"
```

Deploy correto para producao:

```powershell
pnpm exec wrangler pages deploy public --project-name=music
```

Observacao: o script `package.json` pode apontar para `masters-music`, mas o projeto real usado em producao e `music`. Para evitar deploy no projeto errado, use explicitamente `--project-name=music`.

## Secrets Configurados

Os valores ficam criptografados no Cloudflare Pages. Nao colocar valores reais neste arquivo.

Regra operacional para outro Codex/agente:

- Se o usuario ja estiver logado no GitHub/Cloudflare/Chrome, use esses acessos antes de pedir token.
- Se um secret ja existe no Cloudflare, nao peca o valor dele para tarefas normais de deploy/teste.
- Peca valor de secret apenas para rotacao, troca de fornecedor ou quando o secret estiver ausente.
- Nunca tente imprimir secrets no terminal ou no chat.
- Nunca commitar arquivo com token, senha, chave privada, cookie ou bearer token.

Secrets relevantes ja configurados:

- `ADMIN_PASSWORD`
- `CRON_SECRET`
- `KIE_API_KEY`
- `KIWIFY_ACCESS_ID`
- `KIWIFY_PRIVATE_KEY_HEX`
- `META_PIXEL_ID`
- `META_CAPI_TOKEN`
- `META_CAPI_ACCESS_TOKEN`
- `RESEND_API_KEY`
- `FROM_EMAIL`
- `EVOLUTION_API_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_INSTANCE`
- `OWNER_WHATSAPP`
- `MERCADOPAGO_ACCESS_TOKEN`
- `ASAAS_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

Possiveis secrets legados que podem aparecer e nao devem ser removidos sem auditoria:

- `SONORA_CHATBOTIFY_WEBHOOK_TOKEN`
- `PRESENTE_META_CAPI_TOKEN`
- `PRESENTE_MERCADOPAGO_WEBHOOK_SECRET`
- `N8N_WEBHOOK_SECRET`
- `GA_API_SECRET`
- `GROQ_API_KEY`
- `VAPID_PRIVATE_KEY`
- `EFI_CLIENT_ID`
- `EFI_CLIENT_SECRET`
- `EFI_PIX_KEY`
- `EFI_PROXY_URL`
- `EFI_PROXY_SECRET`

Listar secrets sem revelar valores:

```powershell
pnpm exec wrangler pages secret list --project-name=music
```

Adicionar/atualizar secret:

```powershell
pnpm exec wrangler pages secret put NOME_DO_SECRET --project-name=music
```

Depois de alterar secrets, fazer deploy para garantir bundle ativo:

```powershell
pnpm exec wrangler pages deploy public --project-name=music
```

## Matriz de Acesso

Use esta matriz antes de pedir qualquer coisa ao usuario.

| Area | Onde fica | O que normalmente precisa | Pedir ao usuario? |
| --- | --- | --- | --- |
| Codigo | GitHub `owennd2/masters-music` | Clone/push com login GitHub | So se GitHub nao estiver autenticado |
| Producao | Cloudflare Pages `music` | `wrangler` logado ou Chrome logado | So se `wrangler whoami` falhar |
| Secrets | Cloudflare Pages | Secret list e secret put | Nao pedir valores se ja existem |
| Pedidos | Cloudflare KV `ORDERS_KV` | Admin API ou Wrangler KV | Pedir `ADMIN_PASSWORD` so se nao tiver sessao/admin |
| Audios | R2 `sonara-audio` | Cloudflare login | Nao pedir token se wrangler esta logado |
| Email | Resend | `RESEND_API_KEY` em secret | Nao pedir se secret existe |
| WhatsApp | VPS/Evolution | `EVOLUTION_*` em secrets | Nao pedir se secret existe e teste passa |
| Pagamento Pix | Kiwify | `KIWIFY_*` em secrets | Nao pedir se webhook funciona |
| Geracao IA | KIE/Sunor | `KIE_API_KEY`/`SUNOR_API_KEY` | Nao pedir se geracao funciona |
| Pixel | Meta | `META_PIXEL_ID` e `META_CAPI_TOKEN` | Nao pedir se evento CAPI recebe 200 |

## Setup em Outro Computador

1. Instalar/abrir Codex.
2. Entrar na mesma conta.
3. Conectar GitHub ou clonar manualmente:

```powershell
git clone https://github.com/owennd2/masters-music.git
cd masters-music
```

4. Instalar dependencias:

```powershell
pnpm install
```

5. Verificar Cloudflare:

```powershell
pnpm exec wrangler whoami
pnpm exec wrangler pages secret list --project-name=music
```

6. Se `wrangler whoami` falhar, autenticar:

```powershell
pnpm exec wrangler login
```

7. Rodar deploy apenas quando tiver alteracao necessaria:

```powershell
pnpm exec wrangler pages deploy public --project-name=music
```

## Como Evitar Parar a Oferta Ativa

Quando campanha estiver rodando, seguir esta regra:

- Nao alterar `public/index.html`, `public/auto/index.html`, `public/manual/index.html`, `functions/create-payment.ts`, `functions/kiwify-pix-webhook.ts`, `functions/payment-status.ts` ou preco/copy sem confirmar explicitamente.
- Antes de qualquer deploy, conferir:

```powershell
git diff --name-only
```

- Se aparecer arquivo de oferta/checkout e a tarefa nao era oferta, parar e avisar o usuario.
- Mudancas seguras durante campanha: documentacao, admin, relatorios, flags de pedido, runbooks e pequenos endpoints internos.
- Mesmo deploy de functions recompila bundle; por isso, antes de publicar, sempre conferir diff.

## Fluxo Principal

1. Cliente entra em `https://mastersmusic.com.br/`.
2. Frontend captura UTMs e `fbclid`.
3. Cliente preenche briefing e gera pagamento.
4. Pedido fica no KV como `order:<paymentId>`.
5. Webhook de pagamento marca `paid=true`.
6. Sistema inicia geracao automatica via Sunor/KIE.
7. Audio pronto e salvo no R2.
8. Cliente acessa `/pronto/?id=<paymentId>`.
9. Email de entrega vai pela Resend.
10. WhatsApp de entrega vai pela Evolution API.
11. Admin acompanha tudo em `/admin`.

## Webhooks e Endpoints Importantes

Webhooks/rotas de producao:

```text
https://mastersmusic.com.br/kiwify-pix-webhook
https://mastersmusic.com.br/kiwify-webhook
https://mastersmusic.com.br/mp-webhook
https://mastersmusic.com.br/asaas-webhook
https://mastersmusic.com.br/kie-callback?orderId=<paymentId>
https://mastersmusic.com.br/delivery-recovery?secret=<CRON_SECRET>
https://mastersmusic.com.br/pix-recovery?secret=<ADMIN_PASSWORD ou CRON_SECRET>
```

Rotas publicas de cliente:

```text
https://mastersmusic.com.br/
https://mastersmusic.com.br/auto/
https://mastersmusic.com.br/manual/
https://mastersmusic.com.br/pronto/?id=<paymentId>
https://mastersmusic.com.br/qr?id=<paymentId>
https://mastersmusic.com.br/conta
```

Rotas administrativas:

```text
https://mastersmusic.com.br/admin
https://mastersmusic.com.br/admin-orders
https://mastersmusic.com.br/admin-stats
https://mastersmusic.com.br/admin-pricing
```

## Arquivos Principais

- Front principal: `public/index.html`
- Front auto: `public/auto/index.html`
- Admin: `public/admin/index.html`
- Pagina de entrega: `public/pronto/index.html`
- Criar pagamento: `functions/create-payment.ts`
- Webhook Kiwify Pix: `functions/kiwify-pix-webhook.ts`
- Status pagamento: `functions/payment-status.ts`
- Status/geracao automatica: `functions/auto-status.ts`
- Callback KIE: `functions/kie-callback.ts`
- Recuperacao de entrega por cron: `functions/delivery-recovery.ts`
- Admin API: `functions/admin-orders.ts`
- Email Resend: `functions/_shared/resend.ts`
- WhatsApp Evolution: `functions/_shared/whatsapp.ts`
- Meta CAPI: `functions/_shared/meta-capi.ts`
- KV helpers/metadata: `functions/_shared/kv-helpers.ts`

## Admin

URL:

```text
https://mastersmusic.com.br/admin
```

Autenticacao:

- Basic Auth usando a senha de `ADMIN_PASSWORD`.
- Nao guardar a senha neste arquivo.

O admin le UTMs:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_term`
- `utm_content`
- `fbclid`

UTM recomendado para anuncios Meta:

```text
utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}_{{campaign.id}}&utm_term={{adset.name}}_{{adset.id}}&utm_content={{ad.name}}_{{ad.id}}
```

URL final exemplo:

```text
https://mastersmusic.com.br/?utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}_{{campaign.id}}&utm_term={{adset.name}}_{{adset.id}}&utm_content={{ad.name}}_{{ad.id}}
```

Como o admin agrupa:

- Campanha: `utm_campaign`
- Criativo/anuncio: `utm_content`
- Conjunto/adset: `utm_term`
- Plataforma: `utm_source` ou presenca de `fbclid`

Se um pedido cair como direto/organico, verificar se a URL do anuncio estava com UTMs e se o cliente nao removeu parametros ao navegar.

## Pixel e Meta CAPI

Pixel ID:

```text
4090193661124064
```

Compra usa deduplicacao:

- Browser Pixel: `eventID = purchase_<paymentId>`
- Server CAPI: `event_id = purchase_<paymentId>`

Arquivos:

- Front purchase: `public/index.html`, `public/auto/index.html`, `public/manual/index.html`
- Server CAPI: `functions/_shared/meta-capi.ts`

Checklist do pixel antes de subir campanha:

- `fbq('init', '4090193661124064')` presente nas paginas principais.
- Evento `PageView` presente.
- Evento `ViewContent` presente.
- Evento `InitiateCheckout` disparando ao chegar no pagamento.
- Evento `AddPaymentInfo` disparando ao gerar Pix/cartao.
- Evento `Purchase` disparando apos pagamento confirmado.
- Server CAPI enviando `Purchase` com mesmo `event_id`.
- Eventos aparecem no Events Manager da Meta.

Teste CAPI interno:

```text
https://mastersmusic.com.br/test-capi?secret=<ADMIN_PASSWORD ou CRON_SECRET>
```

Se o teste direto da Graph API retornar `events_received: 1`, token esta funcional.

## Email - Resend

Dominio de envio:

```text
mastersmusic.com.br
```

Remetente configurado:

```text
Masters Music <noreply@mastersmusic.com.br>
```

Secret:

```text
RESEND_API_KEY
FROM_EMAIL
```

Teste leve pela producao:

```powershell
$body = @{ email = 'EMAIL_DE_TESTE' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'https://mastersmusic.com.br/account/request-code' -ContentType 'application/json' -Body $body
```

Resposta esperada:

```json
{ "ok": true }
```

Limite Free da Resend usado no inicio:

- 100 emails/dia
- 3.000 emails/mes

Se a campanha crescer, subir para plano pago antes de bater limite.

Diagnostico rapido Resend:

- Se `/account/request-code` retorna `{ "ok": true }`, o site consegue enviar email.
- Se email nao chega, verificar spam/promocoes.
- Se Resend retornar dominio nao verificado, verificar DNS em Resend > Domains.
- Registros esperados:
  - TXT `resend._domainkey.mastersmusic.com.br`
  - MX `send.mastersmusic.com.br` para Amazon SES da regiao Sao Paulo
  - TXT `send.mastersmusic.com.br` com SPF Amazon SES
  - DMARC `_dmarc.mastersmusic.com.br` recomendado, mas nao obrigatorio para envio basico

Nao trocar `FROM_EMAIL` para dominio nao verificado.

## WhatsApp - Evolution API

Numero de suporte:

```text
+55 41 8886-9695
```

Instance:

```text
AudiosClientes
```

Secrets:

```text
EVOLUTION_API_URL
EVOLUTION_API_KEY
EVOLUTION_INSTANCE
OWNER_WHATSAPP
```

Arquivo:

```text
functions/_shared/whatsapp.ts
```

Existe cron na VPS chamando `delivery-recovery` a cada minuto para recuperar entregas prontas que ainda nao tiveram notificacao.

Endpoint:

```text
https://mastersmusic.com.br/delivery-recovery?secret=<CRON_SECRET>
```

Forcar pedido especifico:

```text
https://mastersmusic.com.br/delivery-recovery?secret=<CRON_SECRET>&paymentId=<PAYMENT_ID>
```

Diagnostico rapido WhatsApp:

- Conferir se `EVOLUTION_INSTANCE=AudiosClientes`.
- Conferir se numero conectado e o de suporte `554188869695`.
- Conferir se `delivery-recovery` retorna `whatsappNotifSent: true` ao forcar um pedido pronto.
- Se API falhar, olhar VPS/proxy Evolution.

Regra importante:

- WhatsApp de entrega nao deve ser enviado dentro de polling repetitivo do cliente.
- O envio fica centralizado no cron `delivery-recovery` para evitar duplicidade.

## VPS

VPS hospeda/proxy Evolution API.

- IP: `144.172.114.112`
- Usuario: `root`
- Nao armazenar senha neste arquivo.

Cron instalado:

```text
/etc/cron.d/masters-delivery-recovery
```

Objetivo:

- Rodar recuperacao de entrega a cada 1 minuto.
- Evitar que pedido pronto fique sem email/WhatsApp por falha de polling do cliente.

Comandos uteis na VPS, quando autenticado:

```bash
systemctl status cron
cat /etc/cron.d/masters-delivery-recovery
docker ps
docker logs --tail=100 <container_evolution>
```

Se precisar gerar novo QR do WhatsApp:

1. Entrar na Evolution API/painel da VPS.
2. Verificar instance `AudiosClientes`.
3. Se desconectada, gerar QR.
4. Escanear com o WhatsApp do numero `+55 41 8886-9695`.
5. Testar envio com pedido controlado ou rota de recovery.

Nao trocar instance sem atualizar `EVOLUTION_INSTANCE` no Cloudflare.

## Pagamento - Kiwify

Credenciais ficam nos secrets:

```text
KIWIFY_ACCESS_ID
KIWIFY_PRIVATE_KEY_HEX
```

Rotas:

```text
functions/create-payment.ts
functions/kiwify-pix-webhook.ts
```

Webhook configurado:

```text
https://mastersmusic.com.br/kiwify-pix-webhook
```

Evento usado no webhook:

- QR Code Pix recebido
- Deposito Pix recebido
- Pedido de checkout pago, se disponivel

O webhook valida assinatura com chave publica da Kiwify. O access id criado foi:

```text
70fa8b44-59da-4d3f-aec0-d9549724beb4
```

Nao colocar a chave privada neste arquivo.

## Geracao de Musica - KIE/Sunor

Fluxo atual usa fallback:

1. Tenta provedor principal quando configurado.
2. Usa KIE quando necessario.
3. Salva URLs permanentes/R2.
4. Atualiza pedido no KV.
5. Envia email/WhatsApp quando pronto.

Arquivos:

```text
functions/_shared/generation.ts
functions/_shared/audio-store.ts
functions/auto-status.ts
functions/kie-callback.ts
functions/music-status.ts
```

Secrets:

```text
KIE_API_KEY
SUNOR_API_KEY
```

Se um pedido ficar travado como gerando:

1. Buscar pedido no admin por `paymentId`.
2. Ver se existe `kie_task_id`, `sunor_task_id` ou `treblo_status`.
3. Abrir modal no admin e tentar forcar geracao se houver letra salva.
4. Se audio existe em fonte externa mas nao no R2, usar rota de correcao apropriada (`fix-kie-audio`) com cuidado.
5. Se necessario, subir manualmente via admin/upload.

## Manutencao de Pedido

O pedido fica no KV:

```text
order:<paymentId>
```

Buscar pedido pelo admin API:

```powershell
$paymentId = 'music-EXEMPLO'
$adminPass = 'SENHA_ADMIN'
$pair = ':' + $adminPass
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))
Invoke-RestMethod -Uri "https://mastersmusic.com.br/admin-orders?paymentId=$paymentId" -Headers @{ Authorization = $auth }
```

Marcar email e WhatsApp como enviados:

```powershell
$paymentId = 'music-EXEMPLO'
$adminPass = 'SENHA_ADMIN'
$pair = ':' + $adminPass
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))
$body = @{
  deliveryEmailSent = $true
  whatsappNotifSent = $true
  whatsappSentAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Patch `
  -Uri "https://mastersmusic.com.br/admin-orders?paymentId=$paymentId" `
  -Headers @{ Authorization = $auth } `
  -ContentType 'application/json' `
  -Body $body
```

Campos permitidos no PATCH de `admin-orders`:

- `delivered`
- `notes`
- `status`
- `prodStatus`
- `musicLink`
- `savedLetra`
- `videoDelivered`
- `videoPending`
- `paid`
- `refunded`
- `phone`
- `responsavel`
- `confirmationEmailSent`
- `deliveryEmailSent`
- `whatsappNotifSent`
- `whatsappSentAt`

Marcar pedido como entregue manualmente:

```powershell
$body = @{ delivered = $true } | ConvertTo-Json
Invoke-RestMethod `
  -Method Patch `
  -Uri "https://mastersmusic.com.br/admin-orders?paymentId=$paymentId" `
  -Headers @{ Authorization = $auth } `
  -ContentType 'application/json' `
  -Body $body
```

Adicionar observacao:

```powershell
$body = @{ notes = 'Obs interna aqui' } | ConvertTo-Json
Invoke-RestMethod `
  -Method Patch `
  -Uri "https://mastersmusic.com.br/admin-orders?paymentId=$paymentId" `
  -Headers @{ Authorization = $auth } `
  -ContentType 'application/json' `
  -Body $body
```

Reenviar email de musica pronta pelo admin:

```text
POST /admin-orders?action=send-music-email&paymentId=<paymentId>
```

Forcar geracao pelo admin:

```text
POST /admin-orders?action=force-generate&paymentId=<paymentId>
```

Importante:

- `delivered=true` significa que cliente baixou/foi marcado como entregue.
- `deliveryEmailSent=true` significa que email foi disparado.
- `whatsappNotifSent=true` significa que WhatsApp foi disparado.
- Nao marcar `delivered=true` apenas porque email/WhatsApp saiu, a menos que a operacao queira considerar como entregue.

## Consultas Diretas no KV

Preferir admin API. Se precisar usar Wrangler:

```powershell
pnpm exec wrangler kv key get "order:<paymentId>" --namespace-id 1e913380853c44e9a7d0ffca3f7cd58f
```

Listar pedidos:

```powershell
pnpm exec wrangler kv key list --namespace-id 1e913380853c44e9a7d0ffca3f7cd58f --prefix "order:"
```

Evitar editar JSON bruto no KV sem backup do valor anterior.

## Recuperacao de Incidentes

Pedido pago, mas musica nao gera:

1. Verificar admin: pago? letra salva? `source=auto`?
2. Ver `auto-status`:
   ```text
   https://mastersmusic.com.br/auto-status?paymentId=<paymentId>
   ```
3. Se sem task e com letra, usar force-generate no admin.
4. Se task existe, aguardar ou consultar provedor.
5. Se provider falhou, tentar fallback KIE.

Musica pronta, mas cliente nao recebeu:

1. Ver pedido: `mp3_url`, `treblo_status=success`, `prodStatus=pronto`.
2. Forcar:
   ```text
   /delivery-recovery?secret=<CRON_SECRET>&paymentId=<paymentId>
   ```
3. Conferir `deliveryEmailSent` e `whatsappNotifSent`.
4. Se necessario, marcar flags manualmente somente apos confirmar envio.

Email nao chega:

1. Testar `/account/request-code`.
2. Ver Resend logs.
3. Ver limite diario/mensal.
4. Conferir dominio Resend.

WhatsApp nao chega:

1. Ver `EVOLUTION_*`.
2. Conferir instance conectada.
3. Conferir VPS/proxy.
4. Reautenticar QR se desconectado.

Pixel nao marca:

1. Ver se `fbq` carregou.
2. Ver Events Manager.
3. Ver CAPI secret.
4. Ver `event_id` dedupe.
5. Fazer teste CAPI.

Admin nao abre:

1. Conferir `ADMIN_PASSWORD`.
2. Conferir Basic Auth.
3. Testar `/admin-orders` com header.
4. Ver logs Cloudflare Pages Functions.

## Rollback

Se um deploy novo quebrar producao:

1. Ver ultimo commit bom:

```powershell
git log --oneline -5
```

2. Voltar criando commit de reversao:

```powershell
git revert <commit_ruim>
git push origin main
git push production main
pnpm exec wrangler pages deploy public --project-name=music
```

3. Tambem e possivel usar rollback pelo painel Cloudflare Pages > Deployments.

Nunca usar `git reset --hard` em maquina com alteracoes nao revisadas.

## Campanha Meta

Setup recomendado para primeira campanha:

- CBO
- Otimizacao para Purchase
- Orcamento inicial sugerido: R$ 300/dia
- Publico aberto ou amplo
- 10 criativos no conjunto/alocacao da Meta
- Nao mexer nas primeiras 48-72 horas salvo erro tecnico

UTM obrigatoria:

```text
utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}_{{campaign.id}}&utm_term={{adset.name}}_{{adset.id}}&utm_content={{ad.name}}_{{ad.id}}
```

Antes de subir campanha:

- Compra real testada.
- Musica gerada.
- Download testado.
- Email recebido.
- WhatsApp recebido.
- Purchase no Pixel/CAPI.
- Admin mostrando campanha/UTM.

## Arquivos que Nao Devem Ser Tocados Sem Confirmacao Durante Campanha

- `public/index.html`
- `public/auto/index.html`
- `public/manual/index.html`
- `functions/create-payment.ts`
- `functions/payment-status.ts`
- `functions/kiwify-pix-webhook.ts`
- `functions/_shared/meta-capi.ts`
- `functions/_shared/generation.ts`
- `functions/auto-status.ts`
- `wrangler.toml`

Se a tarefa for apenas suporte/admin/documentacao, nao alterar esses arquivos.

## Arquivos Seguros para Manutencoes Comuns

Mesmo assim, sempre revisar diff antes de deploy.

- `HANDOFF_MASTERS_MUSIC.md`
- `functions/admin-orders.ts`
- `public/admin/index.html`
- `functions/admin-stats.ts`
- `functions/delivery-recovery.ts`
- `functions/_shared/resend.ts`
- `functions/_shared/whatsapp.ts`

## Checklist para Outro Codex Antes de Agir

1. Ler este arquivo inteiro.
2. Rodar:

```powershell
git status --short
git remote -v
```

3. Confirmar se a tarefa mexe em oferta ativa.
4. Se campanha esta rodando, evitar alteracoes em pagina de venda/checkout.
5. Preferir admin API para manutencao de pedido.
6. Nao pedir token se o secret ja existe e o teste passa.
7. Nao expor valores sensiveis em resposta.
8. Fazer diff antes de commit/deploy.
9. Depois de mudar codigo, deploy em `--project-name=music`.
10. Commitar e pushar para `origin` e `production` quando for mudanca relevante.

## Testes Pos-Deploy

1. Abrir site:

```text
https://mastersmusic.com.br/
```

2. Testar email:

```text
POST /account/request-code
```

3. Testar admin:

```text
https://mastersmusic.com.br/admin
```

4. Testar pedido real ou pedido controlado:

```text
https://mastersmusic.com.br/pronto/?id=<paymentId>
```

5. Verificar Meta CAPI no Events Manager.

6. Verificar Resend se email saiu.

7. Verificar WhatsApp no numero de suporte.

## Regras de Seguranca

- Nunca commitar `.env` com valores reais.
- Nunca colocar token Meta, Resend, Kiwify, Cloudflare, KIE ou Evolution neste handoff.
- Secrets devem ficar no Cloudflare Pages.
- Se trocar dominio ou nome de projeto, atualizar `wrangler.toml`, Cloudflare Pages e este handoff.
- Ao editar flags de pedido manualmente, sempre buscar o pedido antes e salvar apenas campos necessarios.

## Estado Atual Conhecido

- Dominio `mastersmusic.com.br` funcionando em producao.
- Compra real testada com sucesso.
- Geracao automatica testada com sucesso.
- Download em `/pronto` funcionando.
- Email Resend testado com sucesso.
- WhatsApp Evolution testado com sucesso.
- Pixel/CAPI configurado com deduplicacao de Purchase.
- Admin le campanhas via UTMs e agrupa campanha/criativo/conjunto.
- Suporte configurado para `+55 41 8886-9695`.
