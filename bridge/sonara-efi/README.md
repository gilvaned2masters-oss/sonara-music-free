# Ponte Efí da Sonara (contingência VPS, não instalada)

O caminho primário é o Worker em `workers/sonara-efi-gateway`, que usa um
binding mTLS do Cloudflare e Cron Trigger. Este diretório é somente a
contingência mínima caso o binding mTLS direto não seja viável na conta Efí.
Ela não registra webhook Efí: o Pages consulta a cobrança autenticada para
confirmar o pagamento, preservando integralmente o webhook da Nail.

O Pages recebe somente `EFI_BRIDGE_URL` e `EFI_BRIDGE_TOKEN`. Credenciais Efí
e certificado `.p12` permanecem exclusivamente na VPS e nunca são versionados.
Ela não armazena músicas, arquivos de clientes, histórico de pedidos nem roda
geração musical.
