# Sonara + Efí Bank: implantação controlada

Esta mudança foi preparada na branch `sonara-efi-polling`. Ela não instala
serviços, não publica Pages, não cria cobranças e não registra webhook.

## Arquitetura

`Cloudflare Pages (Sonara)` chama uma ponte própria da Sonara com um token
exclusivo. A ponte, na porta local `8081`, guarda o certificado mTLS e chama a
API Pix Efí. O Pages nunca recebe o `.p12`, a senha do certificado, Client ID
ou Client Secret. Nada nesta arquitetura utiliza, altera ou compartilha a
ponte, o webhook, o banco ou os serviços da Nail.

O endpoint `payment-status` consulta a Efí autenticadamente para cada Pix
pendente. Só um status `CONCLUIDA` libera o pedido. A ponte usa uma trava
persistente por TXID para serializar a ativação; o e-mail usa chave de
idempotência e o evento Meta usa o ID estável do pedido.

Não há configuração de webhook Efí nesta implantação. Isso evita substituir a
URL associada à chave Pix que pertence à Nail. A confirmação é feita por dois
scanners autenticados e exclusivos da Sonara: `efi-settlement-scan` percorre
pedidos Efí ainda pendentes no KV e só aprova `CONCLUIDA` com TXID e valor
iguais; `production-scan` continua geração, entrega e nova tentativa de e-mail
para pedidos pagos. Portanto o comprador pode fechar o navegador. Nenhum dado
enviado pelo navegador é aceito como confirmação.

## Variáveis do Cloudflare Pages — Sonara somente

Configure somente no projeto Pages confirmado como Sonara:

```text
EFI_BRIDGE_URL=https://<host-sonara>/sonara-efi
EFI_BRIDGE_TOKEN=<token-aleatorio-exclusivo-da-ponte>
SONARA_SETTLEMENT_TOKEN=<segredo-aleatorio-exclusivo-do-timer>
```

`SONARA_SETTLEMENT_TOKEN` deve ser configurado como segredo no Pages e ter o
mesmo valor exclusivamente no arquivo de ambiente da ponte Sonara. As
variáveis existentes continuam necessárias: `ORDERS_KV`, `RESEND_API_KEY`,
`FROM_EMAIL`, `META_PIXEL_ID`, `META_CAPI_TOKEN`, `SUNOR_API_KEY`,
`KIE_API_KEY`, `ADMIN_PASSWORD`, `OWNER_WHATSAPP`, `VAPID_*`,
`CALLMEBOT_API_KEY`, `CRON_SECRET` e as demais já usadas pela Sonara.

Nunca configurar no Pages: `EFI_CLIENT_SECRET`, conteúdo do `.p12`, senha do
certificado ou token de qualquer serviço Nail.

## VPS — somente após autorização separada

Os arquivos em `bridge/sonara-efi/` devem ser copiados para uma instalação
separada, por exemplo `/opt/sonara-efi`. Usar o unit `sonara-efi.service`,
`sonara-efi-settlement.service` e `sonara-efi-settlement.timer`, com arquivo
protegido `/etc/sonara-efi/sonara-efi.env`. O timer roda a cada minuto, tem
limite de 55 segundos e chama os dois scanners internos. O Nginx deve expor uma
rota ou host exclusivo da Sonara; não reutilizar ou editar a rota `efi-bridge`
da Nail.

Antes de iniciar, validar a versão Node 22 com `node:sqlite`, permissões do
certificado, HTTPS, token da ponte e resposta local de uma consulta simulada.
Somente após autorização: `systemctl daemon-reload`, habilitar/iniciar o
serviço da ponte e habilitar o timer. Não registrar webhook Efí.

## Conferência obrigatória antes de qualquer deploy

Há três nomes históricos no repositório: `sonara-music-free` no `wrangler.toml`,
`masters-music` no script de deploy e `sonara-music` na especificação. Não
publique enquanto o projeto Pages que atende `sonara-music-ewu.pages.dev` não
for confirmado. Verificação somente leitura no painel: **Cloudflare Dashboard
→ Workers & Pages → Pages**, abrir cada projeto candidato e em **Settings →
General → Project name** comparar o subdomínio `*.pages.dev`; em **Custom
domains** confirmar o domínio associado. Alternativamente, uma sessão já
autenticada pode executar `wrangler pages project list`. Não é necessário nem
deve ser enviado token pelo chat. Ajuste o nome apenas após essa confirmação.

## Teste sem movimentação financeira

1. `tsc --noEmit`, `node --check bridge/sonara-efi/server.mjs` e
   `node --test tests/efi-settlement-core.test.mjs`.
2. Em homologação Efí, criar uma cobrança de baixo valor e validar QR, payload
   e consulta `ATIVA`/`CONCLUIDA`.
3. Verificar KV, painel, Resend, Meta CAPI e início de geração com dados de
   teste.
4. Com a página fechada, observar duas execuções do timer e confirmar uma única
   geração/e-mail/evento; repetir uma consulta concorrente.
5. Só então, com autorização, realizar um Pix real de teste.
