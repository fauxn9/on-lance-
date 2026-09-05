// Windows : pas de console noire derriere la fenetre en version publiee.
// En debug on la garde, c'est la seule facon de lire les journaux de la boucle.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    onlance_app_lib::run()
}
