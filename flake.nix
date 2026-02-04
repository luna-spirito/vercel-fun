{
  description = "Wikidot Proxy Standalone Module";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        packages.default = pkgs.buildNpmPackage {
          pname = "wikidot-proxy";
          version = "1.0.0";
          src = ./.;
          npmDepsHash = "sha256-G8ejrwO8QRGZ9Zu3Jper3qHgB0P0fE2WxSutJ9eHfQQ=";
          nativeBuildInputs = [ pkgs.typescript ];
          installPhase = ''
            runHook preInstall
            mkdir -p $out/bin $out/lib/node_modules/wikidot-proxy
            cp -r . $out/lib/node_modules/wikidot-proxy
            makeWrapper ${pkgs.nodejs}/bin/node $out/bin/wikidot-proxy \
              --add-flags "$out/lib/node_modules/wikidot-proxy/dist/index.js"
            runHook postInstall
          '';
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
            typescript
            nodePackages.typescript-language-server
          ];
        };
      }
    )
    // {
      nixosModules.default =
        { configFile, environmentFile }:
        {
          pkgs,
          ...
        }:
        {
          users.groups."wikidot-proxy" = { };
          users.users."wikidot-proxy" = {
            isSystemUser = true;
            group = "wikidot-proxy";
          };
          systemd.services.wikidot-proxy = {
            description = "Wikidot Proxy";
            after = [ "network.target" ];
            wantedBy = [ "multi-user.target" ];
            serviceConfig = {
              ExecStart = "${self.packages.${pkgs.system}.default}}/bin/wikidot-proxy ${configFile}";
              EnvironmentFile = environmentFile;
              Restart = "always";
              User = "wikidot-proxy";
              CapabilityBoundingSet = "";
              NoNewPrivileges = true;
              PrivateTmp = true;
              ProtectSystem = "strict";
              ProtectHome = true;
              ReadWritePaths = [ ];
            };
          };
        };
    };
}
