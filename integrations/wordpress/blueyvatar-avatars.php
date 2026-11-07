<?php
/**
 * Plugin Name:       BlueyVatar Avatars
 * Description:       Serves WordPress avatars from a BlueyVatar delivery host instead of Gravatar. The email is hashed on your server with SHA-256 and never appears in a URL.
 * Version:           0.1.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * License:           Apache-2.0
 * License URI:       https://www.apache.org/licenses/LICENSE-2.0
 * Text Domain:       blueyvatar-avatars
 *
 * @package blueyvatar-avatars
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/includes/url.php';

const BLUEYVATAR_OPTION = 'blueyvatar_avatars';

/**
 * Saved settings merged over the defaults.
 */
function blueyvatar_settings(): array {
	$saved = get_option( BLUEYVATAR_OPTION, array() );
	return array_merge(
		array(
			'base_url' => BLUEYVATAR_DEFAULT_BASE_URL,
			'style'    => 'identicon',
			'rating'   => 'g',
		),
		is_array( $saved ) ? $saved : array()
	);
}

/**
 * Resolve the email behind whatever WordPress passes to get_avatar_url.
 *
 * Returns '' for a bare Gravatar hash or anything else without an email, so the caller leaves the URL alone.
 *
 * @param mixed $id_or_email User ID, email, WP_User, WP_Post, or WP_Comment.
 */
function blueyvatar_email_for( $id_or_email ): string {
	if ( is_numeric( $id_or_email ) ) {
		$user = get_user_by( 'id', (int) $id_or_email );
		return $user ? (string) $user->user_email : '';
	}
	if ( is_string( $id_or_email ) ) {
		return is_email( $id_or_email ) ? $id_or_email : '';
	}
	if ( $id_or_email instanceof WP_User ) {
		return (string) $id_or_email->user_email;
	}
	if ( $id_or_email instanceof WP_Post ) {
		$user = get_user_by( 'id', (int) $id_or_email->post_author );
		return $user ? (string) $user->user_email : '';
	}
	if ( $id_or_email instanceof WP_Comment ) {
		if ( $id_or_email->user_id ) {
			$user = get_user_by( 'id', (int) $id_or_email->user_id );
			if ( $user ) {
				return (string) $user->user_email;
			}
		}
		return is_email( $id_or_email->comment_author_email ) ? (string) $id_or_email->comment_author_email : '';
	}
	return '';
}

/**
 * Filter: point avatar URLs at the BlueyVatar delivery host.
 *
 * @param string $url          Gravatar URL that WordPress built.
 * @param mixed  $id_or_email  Lookup value.
 * @param array  $args         Avatar arguments (size, force_default, and so on).
 */
function blueyvatar_filter_avatar_url( $url, $id_or_email, $args ) {
	$email = blueyvatar_email_for( $id_or_email );
	if ( '' === $email ) {
		return $url;
	}
	$settings = blueyvatar_settings();
	return blueyvatar_avatar_url(
		$settings['base_url'],
		blueyvatar_email_hash( $email ),
		array(
			'size'          => isset( $args['size'] ) ? $args['size'] : 96,
			'style'         => $settings['style'],
			'rating'        => $settings['rating'],
			'force_default' => ! empty( $args['force_default'] ),
		)
	);
}
add_filter( 'get_avatar_url', 'blueyvatar_filter_avatar_url', 10, 3 );

/**
 * Ask browsers not to send the page address with avatar requests.
 */
function blueyvatar_no_referrer( $args ) {
	$extra = isset( $args['extra_attr'] ) ? (string) $args['extra_attr'] : '';
	if ( false === strpos( $extra, 'referrerpolicy' ) ) {
		$args['extra_attr'] = trim( $extra . ' referrerpolicy="no-referrer"' );
	}
	return $args;
}
add_filter( 'pre_get_avatar_data', 'blueyvatar_no_referrer' );

/**
 * Clean the settings before they are saved.
 */
function blueyvatar_sanitize_settings( $input ): array {
	$input    = is_array( $input ) ? $input : array();
	$defaults = blueyvatar_settings();
	$base     = isset( $input['base_url'] ) ? esc_url_raw( trim( (string) $input['base_url'] ), array( 'https' ) ) : '';
	return array(
		'base_url' => '' !== $base ? untrailingslashit( $base ) : BLUEYVATAR_DEFAULT_BASE_URL,
		'style'    => isset( $input['style'] ) && in_array( $input['style'], BLUEYVATAR_STYLES, true ) ? $input['style'] : $defaults['style'],
		'rating'   => isset( $input['rating'] ) && in_array( $input['rating'], BLUEYVATAR_RATINGS, true ) ? $input['rating'] : $defaults['rating'],
	);
}

/**
 * Add the fields to Settings, Discussion.
 */
function blueyvatar_register_settings(): void {
	register_setting( 'discussion', BLUEYVATAR_OPTION, array( 'sanitize_callback' => 'blueyvatar_sanitize_settings' ) );
	add_settings_section( 'blueyvatar', __( 'BlueyVatar avatars', 'blueyvatar-avatars' ), '__return_false', 'discussion' );
	add_settings_field( 'blueyvatar_base_url', __( 'Delivery base URL', 'blueyvatar-avatars' ), 'blueyvatar_field_base_url', 'discussion', 'blueyvatar' );
	add_settings_field( 'blueyvatar_style', __( 'Default style', 'blueyvatar-avatars' ), 'blueyvatar_field_style', 'discussion', 'blueyvatar' );
	add_settings_field( 'blueyvatar_rating', __( 'Maximum rating', 'blueyvatar-avatars' ), 'blueyvatar_field_rating', 'discussion', 'blueyvatar' );
}
add_action( 'admin_init', 'blueyvatar_register_settings' );

function blueyvatar_field_base_url(): void {
	$s = blueyvatar_settings();
	printf(
		'<input type="url" class="regular-text code" name="%1$s[base_url]" value="%2$s" /><p class="description">%3$s</p>',
		esc_attr( BLUEYVATAR_OPTION ),
		esc_attr( $s['base_url'] ),
		esc_html__( 'HTTPS only. Use your own host if you self-host BlueyVatar.', 'blueyvatar-avatars' )
	);
}

function blueyvatar_field_style(): void {
	$s = blueyvatar_settings();
	echo '<select name="' . esc_attr( BLUEYVATAR_OPTION ) . '[style]">';
	foreach ( BLUEYVATAR_STYLES as $style ) {
		printf( '<option value="%1$s"%2$s>%1$s</option>', esc_attr( $style ), selected( $s['style'], $style, false ) );
	}
	echo '</select><p class="description">' . esc_html__( 'Shown when a person has no avatar. This setting replaces the default chosen above.', 'blueyvatar-avatars' ) . '</p>';
}

function blueyvatar_field_rating(): void {
	$s = blueyvatar_settings();
	echo '<select name="' . esc_attr( BLUEYVATAR_OPTION ) . '[rating]">';
	foreach ( BLUEYVATAR_RATINGS as $rating ) {
		printf( '<option value="%1$s"%2$s>%1$s</option>', esc_attr( $rating ), selected( $s['rating'], $rating, false ) );
	}
	echo '</select>';
}
