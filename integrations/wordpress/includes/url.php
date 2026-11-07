<?php
/**
 * Pure helpers for building blueyvatar avatar URLs. No WordPress functions are called here, so the
 * unit test (tests/test-url.php) can load this file on its own.
 *
 * @package blueyvatar-avatars
 */

if ( ! defined( 'ABSPATH' ) && ! defined( 'BLUEYVATAR_TESTING' ) ) {
	exit;
}

const BLUEYVATAR_DEFAULT_BASE_URL = 'https://img.blueyvatar.com';
const BLUEYVATAR_STYLES           = array( '404', 'mp', 'identicon', 'monsterid', 'wavatar', 'retro', 'robohash', 'pagan', 'initials', 'blank' );
const BLUEYVATAR_RATINGS          = array( 'g', 'pg', 'r', 'x' );

/**
 * Trim and lowercase an email the same way the API and @blueyvatar/avatar do.
 */
function blueyvatar_normalize_email( string $email ): string {
	$trimmed = preg_replace( '/^\s+|\s+$/u', '', $email );
	if ( null === $trimmed ) {
		$trimmed = trim( $email );
	}
	return function_exists( 'mb_strtolower' ) ? mb_strtolower( $trimmed, 'UTF-8' ) : strtolower( $trimmed );
}

/**
 * SHA-256 of the normalized email as 64 lowercase hex characters. The raw email never leaves this function.
 */
function blueyvatar_email_hash( string $email ): string {
	return hash( 'sha256', blueyvatar_normalize_email( $email ) );
}

/**
 * Build the avatar URL for a hash. Values outside the allowed lists are dropped, never sent.
 *
 * @param string $base_url Delivery origin, for example https://img.blueyvatar.com.
 * @param string $hash     64 hex characters from blueyvatar_email_hash().
 * @param array  $opts     size (int), style (string), rating (string), force_default (bool).
 */
function blueyvatar_avatar_url( string $base_url, string $hash, array $opts = array() ): string {
	if ( 1 !== preg_match( '/^[0-9a-f]{64}$/', $hash ) ) {
		throw new InvalidArgumentException( 'hash must be 64 lowercase hex characters' );
	}
	$query = array();
	$size  = isset( $opts['size'] ) ? (int) $opts['size'] : 0;
	if ( $size >= 1 ) {
		$query['s'] = min( $size, 2048 );
	}
	if ( isset( $opts['style'] ) && in_array( $opts['style'], BLUEYVATAR_STYLES, true ) ) {
		$query['d'] = $opts['style'];
	}
	if ( ! empty( $opts['force_default'] ) ) {
		$query['f'] = 'y';
	}
	if ( isset( $opts['rating'] ) && in_array( $opts['rating'], BLUEYVATAR_RATINGS, true ) ) {
		$query['r'] = $opts['rating'];
	}
	$url = rtrim( $base_url, '/' ) . '/avatar/' . $hash;
	return $query ? $url . '?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 ) : $url;
}
