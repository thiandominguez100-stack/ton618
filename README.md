# TON 618 — Explorador 3D

Explorador astronómico estático e interactivo de TON 618, pensado para GitHub Pages.

## Qué incluye

- Escena 3D en Three.js: horizonte de sucesos, esfera de fotones, sombra aparente, disco ecuatorial delgado, imágenes superior/inferior del lado lejano y chorros polares animados conceptuales.
- Vista inicial casi de canto, con composición inspirada en la silueta de Gargantúa de *Interstellar*.
- Interruptor opcional de corrimiento gravitacional y efecto Doppler aproximados para un disco circular Schwarzschild.
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

La visualización mantiene el horizonte como una esfera de radio `r_s` y define las distancias de escena en unidades de `r_s`. Incluye las escalas de esfera de fotones (`1,5 r_s`) y sombra aparente (`3√3 GM/c² ≈ 2,598 r_s`), y una aproximación de corrimiento de frecuencia `g ≈ √(1-r_s/r) / [γ(1-β cos α)]` con intensidad espectral `Iν,obs = g³ Iν,emit`. El disco se dibuja esquemáticamente entre 3 y 16 radios de Schwarzschild; los chorros y la lente gravitacional son representaciones visuales, no una simulación relativista numérica ni una reconstrucción de observaciones de alta resolución. La masa de TON 618 se infiere indirectamente y depende del método de calibración; no debe tratarse como un valor exacto.

## Referencias

- James, von Tunzelmann, Franklin & Thorne (2015), *Gravitational lensing by spinning black holes in astrophysics, and in the movie Interstellar*. [DOI 10.1088/0264-9381/32/6/065001](https://doi.org/10.1088/0264-9381/32/6/065001).
- Event Horizon Telescope, [How realistic are movie depictions of black holes?](https://eventhorizontelescope.org/faq/how-realistic-are-movie-depictions-black-holes-eg-interstellar).

- Shemmer et al. (2004), *The Astrophysical Journal*, 614, 547–557. [DOI 10.1086/423607](https://doi.org/10.1086/423607).
- Valor posterior de 4,07 × 10¹⁰ masas solares atribuido a Ge et al. (2019) y citado, entre otros, en [MNRAS 536 (2025)](https://academic.oup.com/mnras/article/536/4/3177/7923506).
- [Three.js](https://threejs.org/) — motor de renderizado 3D.
