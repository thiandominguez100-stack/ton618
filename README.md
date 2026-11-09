# TON 618 — Explorador 3D

Explorador astronómico estático e interactivo de TON 618, pensado para GitHub Pages.

## Qué incluye

- Escena 3D en Three.js: horizonte de sucesos, anillo de fotones, disco de acreción animado, estrellas y chorros polares conceptuales.
- Cámara orbital con arrastre, zoom con rueda y vistas predefinidas.
- Dos estimaciones de masa para comparar: 66,1 mil millones de masas solares (Shemmer et al., 2004) y 40,7 mil millones (estimación posterior atribuida a Ge et al., 2019).
- Cálculo dinámico del radio y diámetro de Schwarzschild con las constantes físicas indicadas en el panel científico.
- Panel de ecuaciones, datos observacionales, referencias y limitaciones del modelo.

## Publicación

El workflow de GitHub Actions publica automáticamente la rama `main` en GitHub Pages. La dirección esperada es:

https://thiandominguez100-stack.github.io/ton618/

En el repositorio, abre **Settings → Pages** para confirmar que el origen de publicación figure como **GitHub Actions** si GitHub todavía no lo ha activado automáticamente.

## Controles

- Arrastrar: orbitar la cámara.
- Rueda del ratón: acercar o alejar.
- Órbita / Ecuador / Polar: cambiar de vista.
- Panel derecho: cambiar de estimación y activar capas.
- Física: abrir el cuaderno de ecuaciones y fuentes.
- Teclado: flechas para orientar; + y - para zoom; Escape para cerrar el panel.

## Base científica y límites

El horizonte de sucesos se calcula como una solución de Schwarzschild:

`r_s = 2GM/c^2`

La visualización mantiene el horizonte como una esfera de radio `r_s` y define las distancias de escena en unidades de `r_s`. El disco se dibuja esquemáticamente entre 3 y 24 radios de Schwarzschild; los chorros y la lente gravitacional son representaciones visuales, no una simulación relativista numérica ni una reconstrucción de observaciones de alta resolución. La masa de TON 618 se infiere indirectamente y depende del método de calibración; no debe tratarse como un valor exacto.

## Referencias

- Shemmer et al. (2004), *The Astrophysical Journal*, 614, 547–557. [DOI 10.1086/423607](https://doi.org/10.1086/423607).
- Valor posterior de 4,07 × 10¹⁰ masas solares atribuido a Ge et al. (2019) y citado, entre otros, en [MNRAS 536 (2025)](https://academic.oup.com/mnras/article/536/4/3177/7923506).
- [Three.js](https://threejs.org/) — motor de renderizado 3D.
