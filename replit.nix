{pkgs}: {
  deps = [
    pkgs.xorg.xorgserver
    pkgs.gtk3
    pkgs.alsa-lib
    pkgs.at-spi2-atk
    pkgs.atk
    pkgs.cups
    pkgs.nss
    pkgs.libxkbcommon
    pkgs.xorg.libXrandr
    pkgs.xorg.libXScrnSaver
    pkgs.xorg.libxcb
    pkgs.xorg.libXtst
    pkgs.xorg.libXi
    pkgs.xorg.libXext
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcursor
    pkgs.xorg.libXcomposite
    pkgs.xorg.libX11
    pkgs.chromium
  ];
}
