import { css, html, LitElement } from "lit";

/**
 * The demonstrator's root element. For now it holds only the start page's
 * introduction; discovery, login and the Pod views arrive in later
 * milestones (see PLAN.md).
 */
export class DemonstratorApp extends LitElement {
  static override styles = css`
    :host {
      display: block;
      max-width: 44rem;
      margin: 0 auto;
      padding: 2rem 1rem;
      font-family: system-ui, sans-serif;
      line-height: 1.5;
      color: CanvasText;
    }
  `;

  override render() {
    return html`
      <main>
        <h1>Solid Demonstrator</h1>
        <p>
          A WebID is a URL that names a person. Fetching it gives a profile that says which
          services may log them in, and where their data is kept.
        </p>
        <p>This demonstrator will follow a WebID through each step of a Solid app, and show every exchange as it happens.</p>
      </main>
    `;
  }
}

customElements.define("demonstrator-app", DemonstratorApp);
