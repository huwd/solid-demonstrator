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
    (import ./nix/vale.nix { inherit pkgs; })
  ];

  # `devenv test` is the build: the same checks contributors run with
  # `pnpm run check`, from a clean install of the lockfile.
  enterTest = ''
    pnpm install --frozen-lockfile
    pnpm run check
  '';
}
