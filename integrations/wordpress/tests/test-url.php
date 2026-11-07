<?php
/**
 * Unit test for includes/url.php. Run: php integrations/wordpress/tests/test-url.php
 * Needs no WordPress. Exits 1 on the first failure.
 */

define( 'BLUEYVATAR_TESTING', true );
require __DIR__ . '/../includes/url.php';

$failures = 0;
function check( string $name, $actual, $expected ): void {
	global $failures;
	if ( $actual !== $expected ) {
		++$failures;
		fwrite( STDERR, "FAIL $name\n  expected: " . var_export( $expected, true ) . "\n  actual:   " . var_export( $actual, true ) . "\n" );
	}
}

// Known SHA-256 of "ada@example.com" (same value the JavaScript package test uses).
$ada = hash( 'sha256', 'ada@example.com' );
check( 'hash normalizes case and whitespace', blueyvatar_email_hash( "  Ada@Example.COM \n" ), $ada );
check( 'hash is 64 lowercase hex', 1 === preg_match( '/^[0-9a-f]{64}$/', $ada ), true );
check( 'unicode lowercase', blueyvatar_normalize_email( ' ÉLISE@Example.com ' ), 'élise@example.com' );

check( 'bare url', blueyvatar_avatar_url( 'https://img.blueyvatar.com', $ada ), "https://img.blueyvatar.com/avatar/$ada" );
check(
	'full url, param order matches @blueyvatar/avatar',
	blueyvatar_avatar_url( 'https://img.blueyvatar.com/', $ada, array( 'size' => 96, 'style' => 'identicon', 'rating' => 'pg', 'force_default' => true ) ),
	"https://img.blueyvatar.com/avatar/$ada?s=96&d=identicon&f=y&r=pg"
);
check( 'size is capped', blueyvatar_avatar_url( 'https://x.test', $ada, array( 'size' => 99999 ) ), "https://x.test/avatar/$ada?s=2048" );
check( 'unknown style dropped', blueyvatar_avatar_url( 'https://x.test', $ada, array( 'style' => 'https://evil.test/a.png' ) ), "https://x.test/avatar/$ada" );
check( 'unknown rating dropped', blueyvatar_avatar_url( 'https://x.test', $ada, array( 'rating' => 'zz' ) ), "https://x.test/avatar/$ada" );

$threw = false;
try {
	blueyvatar_avatar_url( 'https://x.test', 'ada@example.com' );
} catch ( InvalidArgumentException $e ) {
	$threw = true;
}
check( 'raw email is rejected as a hash', $threw, true );

// Machine-readable output for the JavaScript parity test in apps/web/lib/wordpress-plugin.test.ts.
if ( in_array( '--json', $argv, true ) ) {
	echo json_encode(
		array(
			'hash' => blueyvatar_email_hash( ' Ada@Example.com ' ),
			'url'  => blueyvatar_avatar_url( 'https://img.blueyvatar.com', blueyvatar_email_hash( 'ada@example.com' ), array( 'size' => 96, 'style' => 'identicon', 'rating' => 'pg' ) ),
		)
	);
	exit( $failures ? 1 : 0 );
}

if ( $failures ) {
	fwrite( STDERR, "$failures failure(s)\n" );
	exit( 1 );
}
echo "ok\n";
