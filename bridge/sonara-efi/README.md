# Ponte Efí da Sonara (não instalada)

Este diretório prepara uma ponte exclusiva da Sonara na porta local `8081`.
Ela não registra webhook Efí: o Pages consulta a cobrança autenticada para
confirmar o pagamento, preservando integralmente o webhook da Nail.

O Pages recebe somente `EFI_BRIDGE_URL` e `EFI_BRIDGE_TOKEN`. Credenciais Efí
e certificado `.p12` permanecem exclusivamente na VPS e nunca são versionados.
