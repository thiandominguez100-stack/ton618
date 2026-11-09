# MILLER — Ocean World

Experiencia 3D estática de exploración en un océano infinito, inspirada en el planeta Miller de *Interstellar*.

## Juego

- Cámara de tercera persona con giro libre del ratón y cámara de seguimiento.
- Movimiento WASD, impulso con Espacio y controles táctiles básicos en móviles.
- Océano procedural que se desplaza con el explorador: la superficie parece continuar indefinidamente y no muestra un borde de mundo.
- Ondas superpuestas de distintas longitudes, normales aproximadas, Fresnel, reflejo del cielo, destellos solares y espuma en las crestas.
- Salpicaduras de partículas y anillos de ondas alrededor de las piernas al caminar.
- Gran pared de marea animada en el horizonte y Gargantúa estilizado como elemento del cielo.
- HUD con velocidad, altura local de ola y fase visual de marea.

## Publicación

GitHub Actions despliega el sitio estático en GitHub Pages:

https://thiandominguez100-stack.github.io/ton618/

Código: \`index.html\` + \`game.js\`; sin servidor, Firebase ni instalación.

## Controles

- **W A S D**: caminar por el agua.
- **Ratón**: rotar la cámara.
- **Espacio**: pequeño impulso/salto.
- **Shift**: caminar más rápido.
- **Esc**: pausar o continuar.
- En teléfono: cruceta táctil y arrastre para mirar.

## Modelo de agua y límites científicos

La superficie usa una suma de ondas sinusoidales/Gerstner simplificadas evaluadas en el shader de GPU; las normales se aproximan con diferencias finitas para calcular Fresnel y reflejos de cielo. El sistema de espuma se activa en crestas y las partículas representan salpicaduras.

No es una simulación CFD ni resuelve Navier–Stokes: la superficie no intercambia momento con un fluido volumétrico y la pared de marea es una representación cinemática inspirada en la película. Se eligió una simulación ligera en tiempo real para mantener la exploración fluida en un navegador.

Kip Thorne explicó las grandes olas de Miller como una posible respuesta de los océanos al bamboleo del planeta bajo las enormes fuerzas de marea de Gargantúa; también describió la posibilidad de ondas solitarias/tidales. No existe un conjunto de parámetros observacionales reales para un planeta Miller: la escena no pretende ser una predicción numérica de un exoplaneta conocido.

## Referencias

- Kip Thorne, *The Science of Interstellar*, capítulo sobre Miller y las mareas; [extracto técnico](https://www.space.com/28077-science-of-interstellar-book-excerpt.html).
- [Entrevista de Scientific American a Kip Thorne sobre las olas de Miller](https://www.scientificamerican.com/blog/observations/parsing-the-science-of-interstellar-with-physicist-kip-thorne/).
- James, von Tunzelmann, Franklin & Thorne (2015), [Gravitational lensing by spinning black holes in astrophysics, and in the movie Interstellar](https://doi.org/10.1088/0264-9381/32/6/065001).
- [Three.js ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html) y [PlaneGeometry](https://threejs.org/docs/pages/PlaneGeometry.html).

## Nota de inspiración

MILLER es una experiencia original inspirada en el concepto de un planeta oceánico y sus mareas extremas. Los nombres y elementos cinematográficos se usan como referencia temática; el juego no reproduce assets de la película.
