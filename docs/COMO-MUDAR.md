# Como mudar o WIZArd sem precisar de IA

Tudo o que dá para mudar sem programar fica na pasta **`config/`**. Depois de qualquer mudança, publique:

```powershell
npm.cmd run deploy
```

O deploy roda os testes antes. Se você errar algo no arquivo, ele **não publica** e diz o que corrigir. O bot em produção continua como estava.

## Mensagens e botões — `config/textos.txt`

Cada linha é `nome = texto`. Mude **só o que está depois do `=`**.

```
dm.terceiros = Olá! Sou o assistente de uma campanha privada. O painel e os arquivos são exclusivos do mestre.
```

- `{titulo}`, `{data}` e outras palavras entre chaves são preenchidas pelo bot. Pode tirar ou mudar de lugar, mas não invente novas.
- Para quebrar linha, escreva `\n`.
- Linhas que começam com `#` são comentários (explicam onde o texto aparece).
- Botões: até 80 letras. Descrições do comando `/wizard`: até 100.
- `menu.titulo` pode ficar vazio: o menu mostra só os botões.

Exemplos rápidos:

| Quero mudar… | Linha |
| --- | --- |
| Resposta para quem não é você na DM | `dm.terceiros` |
| Aviso publicado no canal quando começa a gravar | `gravacao.aviso_canal` |
| Nome do botão "Ver última sessão" | `botao.ultima_sessao` |
| Nome dado às sessões gravadas | `sessao.nome` |
| Pergunta "é Serpente?" | `fila.confirmar_mesa` e `sessao.pergunta_mesa` |

## Ajustes — `config/ajustes.txt`

- `fuso`: fuso horário usado nos nomes das sessões.
- `esperar_streamamigos`: `sim` faz transcrições e resumos esperarem o StreamAmigos ficar sem salas abertas (e pausarem se alguém abrir uma sala no meio). `não` desliga isso.
- `dias_guarda`: por quantos dias guardar áudio e transcrições sem resumo (padrão 7). Resumos e coleção ficam para sempre.
- `pos_sessao_minimo_minutos`: no pós-sessão automático, gravações mais curtas que isso só são transcritas, nunca resumidas sozinhas (padrão 5).

## Vocabulário da transcrição — `config/vocabulario.txt`

Uma palavra ou nome por linha, **só para termos que o bot não descobre sozinho** — principalmente os dos Mitos (Yig, shoggoths...). Personagens, NPCs, itens e lugares que já estão na coleção de resumos entram automaticamente.

O Whisper aceita uns 45-50 termos no total. **O topo do arquivo tem prioridade**; o espaço que sobrar é preenchido com nomes das sessões mais recentes. Para ver o que entrou, rode `wizard vocabulario` na VPS depois do deploy.

Mesmo que a transcrição erre um nome, o **resumo** corrige: a IA recebe um glossário com todos os nomes da coleção e o glossário de normalização do seu formato.

## Formato do resumo

`Arquivo Formato Resumo de Sessão.md` (na raiz) é o modelo que a IA segue para o resumo da Serpente de Duas Cabeças.

## Se algo der errado

- `npm.cmd run deploy` falhou nos testes: leia a mensagem; ela diz qual linha ou nome está errado.
- O bot mostra um texto estranho tipo `botao.voltar`: o nome antes do `=` foi alterado ou apagado em `config/textos.txt`.
- Na VPS, `wizard voltar` restaura a versão anterior.
