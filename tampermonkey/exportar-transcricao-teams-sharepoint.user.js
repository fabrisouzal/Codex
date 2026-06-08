// ==UserScript==
// @name         Exportar Transcrição Teams SharePoint
// @namespace    http://tampermonkey.net/
// @version      2026-06-08.01
// @description  Rola o painel de transcrição visível, captura os textos e baixa arquivo TXT/JSON
// @match        *://*.sharepoint.com/*
// @match        *://*.microsoftstream.com/*
// @match        *://teams.microsoft.com/*
// @updateURL    https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/exportar-transcricao-teams-sharepoint.user.js
// @downloadURL  https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/exportar-transcricao-teams-sharepoint.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        intervaloRolagemMs: 900,
        pixelsPorRolagem: 420,
        maxCiclosRolagem: 220,
        ciclosSemNovosBlocosParaParar: 8,
        nomeBaseArquivo: "transcricao_reuniao",
        modoDebug: false
    };

    let capturando = false;
    let blocosCapturados = new Map();

    function criarBotaoExportar() {
        if (document.getElementById("btnExportarTranscricaoTM")) return;

        const botao = document.createElement("button");
        botao.id = "btnExportarTranscricaoTM";
        botao.innerText = "Exportar transcrição";
        botao.type = "button";
        botao.title = "Exportar transcrição visível para TXT e JSON";

        Object.assign(botao.style, {
            position: "fixed",
            top: "80px",
            right: "20px",
            zIndex: "999999",
            padding: "10px 14px",
            minWidth: "162px",
            background: "#6d28d9",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "14px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.35)"
        });

        botao.onclick = iniciarCaptura;
        document.body.appendChild(botao);
    }

    function logDebug(...args) {
        if (CONFIG.modoDebug) {
            console.log("[Transcrição TM]", ...args);
        }
    }

    function elementoVisivel(el) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);

        return (
            rect.width > 120 &&
            rect.height > 120 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
        );
    }

    function temRolagemVertical(el) {
        return el.scrollHeight > el.clientHeight + 80;
    }

    function pareceTranscricao(texto) {
        if (!texto) return false;

        const textoLimpo = limparTexto(texto);

        const contemTitulo =
            textoLimpo.includes("Transcrição") ||
            textoLimpo.includes("Transcript") ||
            textoLimpo.includes("Pesquisar") ||
            textoLimpo.includes("Search") ||
            textoLimpo.includes("Download") ||
            textoLimpo.includes("Baixar");

        const contemTempo = temMarcadorDeTempo(textoLimpo);

        const contemFalaComum =
            textoLimpo.includes("Mm-hmm") ||
            textoLimpo.includes("Mhm") ||
            textoLimpo.includes("processo") ||
            textoLimpo.includes("reunião") ||
            textoLimpo.includes("duplicidade");

        return contemTitulo || contemTempo || contemFalaComum;
    }

    function encontrarAreaRolavelDaTranscricao() {
        const candidatos = Array.from(document.querySelectorAll("div, section, aside, main"));

        const rolaveis = candidatos
            .filter(el => elementoVisivel(el))
            .filter(el => temRolagemVertical(el))
            .map(el => {
                const texto = limparTexto(el.innerText || "");
                const rect = el.getBoundingClientRect();

                let pontuacao = 0;

                if (pareceTranscricao(texto)) pontuacao += 10;
                if (texto.includes("Transcrição")) pontuacao += 20;
                if (texto.includes("Transcript")) pontuacao += 20;
                if (texto.includes("Pesquisar")) pontuacao += 10;
                if (texto.includes("Search")) pontuacao += 10;
                if (temMarcadorDeTempo(texto)) pontuacao += 20;
                if (texto.length > 300) pontuacao += 5;

                /*
                Dá preferência para painéis laterais,
                como o painel da direita/esquerda de transcrição.
                */
                if (rect.width < window.innerWidth * 0.55) pontuacao += 8;

                return {
                    el,
                    pontuacao,
                    textoPreview: texto.slice(0, 250),
                    altura: el.clientHeight,
                    scrollHeight: el.scrollHeight
                };
            })
            .filter(item => item.pontuacao > 0)
            .sort((a, b) => b.pontuacao - a.pontuacao);

        logDebug("Candidatos roláveis encontrados:", rolaveis);

        return rolaveis.length ? rolaveis[0].el : null;
    }

    function encontrarContainerDeLeitura(areaRolavel) {
        /*
        Normalmente a própria área rolável contém os blocos.
        Caso tenha um filho mais específico, usamos o filho com mais texto.
        */
        const filhos = Array.from(areaRolavel.querySelectorAll("div"));

        let melhor = areaRolavel;
        let maiorTexto = limparTexto(areaRolavel.innerText || "").length;

        filhos.forEach(filho => {
            if (!elementoVisivel(filho)) return;

            const tamanhoTexto = limparTexto(filho.innerText || "").length;

            if (tamanhoTexto > maiorTexto && tamanhoTexto > 100) {
                melhor = filho;
                maiorTexto = tamanhoTexto;
            }
        });

        return melhor;
    }

    function capturarTextos(container) {
        let novosBlocos = 0;
        const blocos = extrairBlocosProvaveis(container);

        blocos.forEach(texto => {
            if (blocosCapturados.has(texto)) return;
            blocosCapturados.set(texto, texto);
            novosBlocos++;
        });

        return novosBlocos;
    }

    function extrairBlocosProvaveis(container) {
        const seletores = [
            "[role='listitem']",
            "[data-tid*='message' i]",
            "[data-tid*='transcript' i]",
            "[data-testid*='message' i]",
            "[data-testid*='transcript' i]",
            "li",
            "p",
            "div"
        ];

        const elementos = Array.from(container.querySelectorAll(seletores.join(",")));
        const candidatos = [];

        elementos.forEach(el => {
            const texto = limparTexto(el.innerText || el.textContent || "");

            if (!texto || texto.length < 8) return;
            if (texto.length > 1800) return;
            if (deveIgnorarTexto(texto)) return;
            if (temFilhoComMesmoTexto(el, texto)) return;
            if (pareceContainerAgregador(el, texto)) return;

            const pontuacao = pontuarBlocoDeTranscricao(texto, el);
            if (pontuacao < 3) return;

            candidatos.push({ texto, pontuacao });
        });

        return candidatos
            .map(item => item.texto);
    }

    function pontuarBlocoDeTranscricao(texto, el) {
        let pontuacao = 0;
        const rect = el.getBoundingClientRect();

        if (temMarcadorDeTempo(texto)) pontuacao += 4;
        if (texto.includes("\n")) pontuacao += 2;
        if (texto.length >= 20) pontuacao += 2;
        if (texto.length >= 80) pontuacao += 1;
        if (rect.height >= 16 && rect.width >= 80) pontuacao += 1;
        if (/\b([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç.-]+)\b/.test(texto)) pontuacao += 1;

        return pontuacao;
    }

    function temFilhoComMesmoTexto(el, texto) {
        return Array.from(el.children).some(filho => {
            const textoFilho = limparTexto(filho.innerText || filho.textContent || "");
            return textoFilho && textoFilho === texto;
        });
    }

    function pareceContainerAgregador(el, texto) {
        if (texto.length < 350) return false;

        const descendentesComTexto = Array.from(el.querySelectorAll("div, p, span, li"))
            .map(filho => limparTexto(filho.innerText || filho.textContent || ""))
            .filter(textoFilho => textoFilho.length >= 8 && textoFilho.length < texto.length);

        return descendentesComTexto.length >= 4;
    }

    function temMarcadorDeTempo(texto) {
        return /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(texto);
    }

    function deveIgnorarTexto(texto) {
        const ignorarExato = [
            "Transcrição",
            "Transcript",
            "Pesquisar",
            "Search",
            "Baixar",
            "Download",
            "Observações",
            "Comentários",
            "Análise",
            "OK"
        ];

        if (ignorarExato.includes(texto)) return true;

        const ignorarContendo = [
            "Exportar transcrição",
            "Capturando",
            "Concluído",
            "Sincronizar",
            "projedata-my.sharepoint.com diz",
            "Não encontrei o painel"
        ];

        return ignorarContendo.some(t => texto.includes(t));
    }

    function limparTexto(texto) {
        return String(texto)
            .replace(/\u00a0/g, " ")
            .replace(/[ \t]+/g, " ")
            .replace(/\n\s+/g, "\n")
            .trim();
    }

    async function iniciarCaptura() {
        if (capturando) {
            alert("A captura já está em andamento.");
            return;
        }

        const areaRolavel = encontrarAreaRolavelDaTranscricao();

        if (!areaRolavel) {
            alert(
                "Não encontrei a área rolável da transcrição.\n\n" +
                "Confirme se o painel Transcrição está aberto e visível na tela.\n\n" +
                "Depois abra o Console do navegador com F12 para ver os candidatos encontrados."
            );
            return;
        }

        capturando = true;
        blocosCapturados.clear();

        const botao = document.getElementById("btnExportarTranscricaoTM");
        botao.innerText = "Capturando...";
        botao.disabled = true;
        botao.style.opacity = "0.8";

        try {
            areaRolavel.scrollTop = 0;
            await esperar(1200);

            let posicaoAnterior = -1;
            let tentativasSemMover = 0;
            let ciclosSemNovosBlocos = 0;

            for (let ciclo = 0; capturando && ciclo < CONFIG.maxCiclosRolagem; ciclo++) {
                const containerLeitura = encontrarContainerDeLeitura(areaRolavel);
                const novosBlocos = capturarTextos(containerLeitura);
                botao.innerText = `Capturando... ${blocosCapturados.size}`;

                ciclosSemNovosBlocos = novosBlocos ? 0 : ciclosSemNovosBlocos + 1;
                areaRolavel.scrollTop += CONFIG.pixelsPorRolagem;

                await esperar(CONFIG.intervaloRolagemMs);

                const posicaoAtual = areaRolavel.scrollTop;

                if (posicaoAtual === posicaoAnterior) {
                    tentativasSemMover++;
                } else {
                    tentativasSemMover = 0;
                }

                posicaoAnterior = posicaoAtual;

                if (tentativasSemMover >= 4 && ciclosSemNovosBlocos >= CONFIG.ciclosSemNovosBlocosParaParar) {
                    break;
                }
            }

            capturarTextos(encontrarContainerDeLeitura(areaRolavel));
            gerarArquivos();
        } catch (erro) {
            console.error("[Transcrição TM] Falha ao capturar transcrição:", erro);
            alert("Falha ao capturar a transcrição. Veja o Console do navegador para detalhes.");
        } finally {
            botao.innerText = "Exportar transcrição";
            botao.disabled = false;
            botao.style.opacity = "1";
            capturando = false;
        }
    }

    function esperar(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function gerarArquivos() {
        let mensagens = Array.from(blocosCapturados.values());

        mensagens = organizarBlocos(mensagens);

        if (!mensagens.length) {
            alert("Nenhum texto foi capturado.");
            return;
        }

        const textoFinal = mensagens.join("\n\n");

        baixarArquivo(criarNomeArquivo("txt"), textoFinal, "text/plain;charset=utf-8");

        const jsonFinal = JSON.stringify(
            {
                total_blocos: mensagens.length,
                capturado_em: new Date().toISOString(),
                origem: location.href,
                transcricao: mensagens
            },
            null,
            2
        );

        baixarArquivo(criarNomeArquivo("json"), jsonFinal, "application/json;charset=utf-8");

        alert(`Captura concluída. Blocos capturados: ${mensagens.length}`);
    }

    function organizarBlocos(lista) {
        /*
        Remove blocos muito grandes que sejam o painel inteiro repetido.
        Mantém blocos menores, que normalmente representam fala/nome/horário.
        */
        return lista
            .map(limparTexto)
            .filter(Boolean)
            .filter(texto => texto.length < 1200)
            .filter(texto => !deveIgnorarTexto(texto))
            .filter((texto, indice, lista) => {
                return !lista.some((outro, outroIndice) => {
                    if (indice === outroIndice) return false;
                    if (outro.length <= texto.length + 40) return false;
                    return outro.includes(texto);
                });
            });
    }

    function baixarArquivo(nomeArquivo, conteudo, tipo) {
        const blob = new Blob([conteudo], { type: tipo });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = nomeArquivo;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(url);
    }

    function criarNomeArquivo(extensao) {
        const agora = new Date();
        const carimbo = [
            agora.getFullYear(),
            String(agora.getMonth() + 1).padStart(2, "0"),
            String(agora.getDate()).padStart(2, "0"),
            String(agora.getHours()).padStart(2, "0"),
            String(agora.getMinutes()).padStart(2, "0")
        ].join("-");

        return `${CONFIG.nomeBaseArquivo}_${carimbo}.${extensao}`;
    }

    function iniciar() {
        if (!document.body) {
            window.setTimeout(iniciar, 500);
            return;
        }

        const observer = new MutationObserver(() => {
            criarBotaoExportar();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        criarBotaoExportar();
    }

    iniciar();

})();
