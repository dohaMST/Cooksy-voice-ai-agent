<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

- Map the Cooksy ember palette, radii and type scale into shared CSS semantic tokens (src/styles.css), so every surface re-themes from one accent property instead of per-component colour rules.
- Keep the brand mark and favicon as committed cropped assets in public/ (cooksy-mark.png, favicon.png) derived from the supplied logo, so the console ships its identity without a remote asset pointer.
- Treat the Three.js ember field and voice orb as optional decoration: they load in a lazy chunk, skip the animation loop under prefers-reduced-motion, and fall back to the CSS haze and ring when WebGL is unavailable — no console behaviour depends on them.
- Voice, run and theme preferences are saved per browser (src/lib/settings/store.ts); the agent a turn is sent to comes from that stored choice and is resolved through the allowlist in src/lib/ai/models.ts, so an unknown pick errors instead of being silently swapped.
- Live theme values are written as CSS custom properties on the document root (src/lib/settings/theme.ts), so every glass surface re-themes instantly without per-component styling.
- Route configured local ASR from the browser through a separate HTTP adapter, reusing console capture and error state so every view shares one microphone pipeline.
- Built-in replies accept only allowlisted model names (src/lib/ai/models.ts); unknown picks error instead of being swapped, so a chosen task model is never silently replaced.
