// Ambient module declarations for the trimmed Plotly bundle used by
// PostImplementationGallery.tsx.
//
// @types/react-plotly.js only declares the main "react-plotly.js" entry
// point (a component built against the full plotly.js bundle) — it does not
// cover the "react-plotly.js/factory" entry point, which is what lets a
// smaller trace-specific Plotly build (here, plotly.js-basic-dist-min,
// covering bar/pie/scatter — all this page needs, at a fraction of full
// plotly.js's ~3.5MB) be swapped in instead of pulling in every trace type.
// plotly.js-basic-dist-min itself ships no types at all. Both are declared
// here directly rather than assumed from upstream typings; PlotParams below
// mirrors react-plotly.js's own real prop surface, kept to just the props
// this app actually passes.

declare module 'plotly.js-basic-dist-min' {
  import type { Data, Layout } from 'plotly.js'

  interface ToImageFigure {
    data: Data[]
    layout?: Partial<Layout>
  }

  interface ToImageOptions {
    format: 'png' | 'jpeg' | 'webp' | 'svg'
    width?: number
    height?: number
    scale?: number
  }

  // Only the slice of the real PlotlyStatic surface this app actually calls
  // directly (utils/plotlyExport.ts's `Plotly.toImage`) — the rest of the
  // library is only ever driven indirectly, through react-plotly.js/factory
  // below, which takes this value untyped (`unknown`) and manages its own
  // instance internally.
  interface MinimalPlotlyStatic {
    toImage(figure: ToImageFigure, opts: ToImageOptions): Promise<string>
  }

  const Plotly: MinimalPlotlyStatic
  export default Plotly
}

declare module 'react-plotly.js/factory' {
  import type { ComponentType, CSSProperties } from 'react'
  import type { Data, Layout, Config, Frame } from 'plotly.js'

  // @types/plotly.js does not export a top-level `Figure` type (see
  // types/postImplementation.ts for where that wrong assumption actually
  // broke a build) — this app never passes onInitialized/onUpdate anyway,
  // so the callback's figure param just gets the same {data, layout} shape
  // used everywhere else instead of importing a name that doesn't exist.
  interface PlotlyFigure {
    data: Data[]
    layout: Partial<Layout>
  }

  export interface PlotParams {
    data: Data[]
    layout?: Partial<Layout>
    frames?: Frame[]
    config?: Partial<Config>
    style?: CSSProperties
    className?: string
    useResizeHandler?: boolean
    divId?: string
    revision?: number
    onInitialized?: (figure: PlotlyFigure, graphDiv: HTMLElement) => void
    onUpdate?: (figure: PlotlyFigure, graphDiv: HTMLElement) => void
    onError?: (err: Error) => void
  }

  export default function createPlotlyComponent(Plotly: unknown): ComponentType<PlotParams>
}
