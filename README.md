# Montaj Portre

3D web exhibition: Vite + TypeScript + three.js, no framework.

```bash
npm install          # also copies the Draco WASM decoder to public/decoders
npm run assets       # raw/<id>/ → public/assets/<id>/ (optimised models, posters, atlas)
npm run dev          # http://localhost:5173  (add ?debug for draw calls / triangles)
npm run build        # static site in dist/
```

## Adding a portrait

```
raw/p02/model.glb    # TRELLIS / scan output
raw/p02/photo.jpg    # photo of the physical piece (poster + detail image)
raw/p02/meta.json    # { "heightCm": 33, "board": { "color": "#6f3b2c", "coverX": [0.03, 0.93], "coverY": [0.02, 0.8] } }
```

`board` rebuilds the wooden board TRELLIS removes with the background.
`coverX`/`coverY` = the fraction of the board (from left / from top, measured on
the photo) that the objects span. Then add the text in `src/content.ts`.

## Performance model

- Ring: 1 draw call for all posters (atlas), real models only for front ±1.
- Rendering on demand: a still page uses no GPU.
- No post-processing pass: grain and vignette are CSS.
- three.js loads after first paint. Initial JS ≈ 5 KB gzipped.
- Models: meshopt (WASM) + WebP. AR file: Draco + JPEG at real size.
