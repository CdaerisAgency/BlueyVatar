<?php
/**
 * Remove the plugin's saved settings on uninstall.
 *
 * @package blueyvatar-avatars
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'blueyvatar_avatars' );
