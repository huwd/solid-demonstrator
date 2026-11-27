{ pkgs, ... }:

{
  # Tools only. Never load secrets here, or every child process (including
  # agent tool calls) would see them.
  #   devenv shell          # interactive shell
  #   devenv test           # install, then run every check, as the build does
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_26;
    # pnpm switches itself to the version in package.json `packageManager`.
    pnpm.enable = true;
  };

  packages = [
    pkgs.actionlint
    # For .github/rulesets/apply.sh.
    pkgs.jq
    pkgs.shellcheck
    # Keep in step with the zizmor version in .github/workflows/ci.yml.
    pkgs.zizmor
    (import ./nix/vale.nix { inherit pkgs; })
  ];

  # Playwright's browsers come from nixpkgs, because the ones it downloads
  # don't run on NixOS. @playwright/test in package.json must be exactly
  # pkgs.playwright-driver.version, or Playwright looks for browser builds
  # that aren't there. See docs/decisions/0012-playwright-for-browser-tests.md.
  env = {
    PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
    PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
    PLAYWRIGHT_NIX_VERSION = pkgs.playwright-driver.version;
    # WebKit needs an EGL driver even when headless. NixOS has one in
    # /run/opengl-driver, but other Linux hosts, such as CI's Ubuntu runners,
    # have none that Nix builds can load. playwright.config.ts points WebKit,
    # and only WebKit, at Mesa from nixpkgs.
    PLAYWRIGHT_MESA = "${pkgs.mesa}";
  };

  # `devenv test` is the build: the same checks contributors run with
  # `pnpm run check`, from a clean install of the lockfile.
  enterTest = ''
    pnpm install --frozen-lockfile
    pnpm run check
  '';
}
