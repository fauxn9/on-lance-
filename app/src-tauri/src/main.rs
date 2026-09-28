// Pas de console noire derrière l'app en version publiée.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    onlance_lib::run()
}
