$(function() {
	var provider;
	var providerETH;
	var providersTries = {};

	var connection;
	var alertTimeout;
	var conf;
	var confToken;
	var confSaga;
	var confAmount;
	var confSuspended = false;
	var confCustomAmounts = false;
	var spentStats = {};
	var metaImage;
	var nfts;
	var metas;
	var sagaNft;

	var $claim = $('#claim');
	var $claim_amount = $('#claim_amount');
	var $connectETH = $('#connect_eth');
	var $connectSOL = $('#connect_sol');
	var $loader = $('.loader');

	var $saga_claim = $('#saga_claim');
	var $saga_connectSOL = $('#saga_connect_sol');

	var SYSTEM_PROGRAM = new solanaWeb3.PublicKey('11111111111111111111111111111111');
	var TOKEN_PROGRAM = new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
	var ASSOCIATED_TOKEN_PROGRAM = new solanaWeb3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
	var METADATA_PROGRAM = new solanaWeb3.PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
	var COMPUTE_BUDGET_PROGRAM = new solanaWeb3.PublicKey('ComputeBudget111111111111111111111111111111');

	var rpc = RPC;

	if (rpc.constructor === Array)
		rpc = rpc[Math.floor(Math.random()*rpc.length)];

	var hrNumber = function(number) {
		var tier = Math.log10(Math.abs(number)) / 3 | 0;

		if(tier == 0)
			return number;

		var suffix = ["", "k", "M", "G", "T", "P", "E"][tier];
		var scale = Math.pow(10, tier * 3);
		var scaled = number / scale;

		return scaled.toFixed(2) + suffix;
	}

	var bin2hex = function(bin) {
		var hex = '0x'+Array.from(bin).map(b => b.toString(16).padStart(2, '0')).join('');
		return hex;
	}
	var hex2bin = function(hex) {
		var bin = []; hex.substr(2).match(/.{2}/g).map(b => bin.push(parseInt(b, 16)));
		return bin;
	}
	var int2le = function(value, kind = 32) {
		let offset = 0;
		let buf = [];
		value = BigInt(value);

		let lo = Number(value & BigInt('0xffffffff'))
		buf[offset++] = lo
		lo = lo >> 8
		buf[offset++] = lo
		lo = lo >> 8
		buf[offset++] = lo
		lo = lo >> 8
		buf[offset++] = lo

		if (kind == 32)
			return buf;

		let hi = Number((value >> BigInt(32)) & BigInt('0xffffffff'))
		buf[offset++] = hi
		hi = hi >> 8
		buf[offset++] = hi
		hi = hi >> 8
		buf[offset++] = hi
		hi = hi >> 8
		buf[offset++] = hi
		return buf;
	}

	var parseError = function(error) {
		var errorCodes = {
			'{"Custom":1}': 'Non-sufficient Funds',
			'{"Custom":17}': 'Account frozen',
			'{"Custom":6000}': 'Invalid ETH Signature',
			'{"Custom":6001}': 'Not Eligible to Claim',
			'{"Custom":6002}': 'Invalid Amount to Claim',
			'{"Custom":6003}': 'Invalid Token to Claim',
			'{"Custom":6004}': 'Claim Suspended',
		};

		if ($('#saga_claim_dialog').is(':visible')) {
			errorCodes = {
				'{"Custom":1}': 'Non-sufficient Funds',
				'{"Custom":17}': 'Account frozen',
				'{"Custom":6000}': 'Not Eligible to Claim',
				'{"Custom":6001}': 'Invalid Token to Claim',
				'{"Custom":6002}': 'Already Claimed',
				'{"Custom":6003}': 'Invalid Saga NFT',
				'{"Custom":6004}': 'No More Spots Left to Claim',
				'{"Custom":6005}': 'Claim Suspended',
			};
		}

		var codes = Object.keys(errorCodes);

		codes.every(function(code) {
			if ((error+'').indexOf(code) != -1) {
				error += " - "+errorCodes[code];
				return false;
			}
			return true;
		});

		return error;
	}

	var transactions = {
		claim: function(eth_wallet, sol_wallet) {
			var msg = bin2hex(new TextEncoder().encode(
				"Sign/Approve this message to confirm ownership of this wallet.\r\n\r\n" +
				"There will be no transaction nor gas fees associated with this request.\r\n\r\n" +
				 (new solanaWeb3.PublicKey(sol_wallet)).toBytes()));

			$claim.attr('disabled', '');

			providerETH.request({
				method: 'personal_sign',
				params: [msg, eth_wallet]
			})
			.then(function(eth_signature) {
				let program = new solanaWeb3.PublicKey(PROGRAM);
				let config = new solanaWeb3.PublicKey(CONFIG);
				let authority = programAuthority(config, PROGRAM)[0];
				let token = new solanaWeb3.PublicKey(confToken);
				let wallet = provider.publicKey;
				let from_account = accountAddress(confToken, authority)[0];
				let to_account = accountAddress(confToken, wallet)[0];
				let amount = parseInt($claim_amount.find('input').val());

				if (amount <= 0 || isNaN(amount))
					amount = 0;

				let budgetKeys = [
					{ pubkey: COMPUTE_BUDGET_PROGRAM, isWritable: false, isSigner: false }
				];

				let dataUnitPrice = new Uint8Array([
					0x03, 0x40, 0x1f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

				let instructionSetUnitPrice = new solanaWeb3.TransactionInstruction({
					programId: COMPUTE_BUDGET_PROGRAM,
					keys: budgetKeys,
					data: dataUnitPrice,
				});

				let dataUnitLimit = new Uint8Array([
					0x02, 0x40, 0x42, 0x0F, 0x00]);

				let instructionSetUnitLimit = new solanaWeb3.TransactionInstruction({
					programId: COMPUTE_BUDGET_PROGRAM,
					keys: budgetKeys,
					data: dataUnitLimit,
				});

				let keys = [
					{ pubkey: wallet, isWritable: true, isSigner: true },
					{ pubkey: config, isWritable: true, isSigner: false },
					{ pubkey: authority, isWritable: true, isSigner: false },
					{ pubkey: token, isWritable: true, isSigner: false },
					{ pubkey: from_account, isWritable: true, isSigner: false },
					{ pubkey: to_account, isWritable: true, isSigner: false },
					{ pubkey: TOKEN_PROGRAM, isWritable: false, isSigner: false },
					{ pubkey: ASSOCIATED_TOKEN_PROGRAM, isWritable: false, isSigner: false },
					{ pubkey: SYSTEM_PROGRAM, isWritable: false, isSigner: false },
				];

				let data = new Uint8Array(8+4+20+64+1);

				// Command, first 8 bytes of global:command using SHA256
				// https://emn178.github.io/online-tools/sha256.html
				data.set([0x3e, 0xc6, 0xd6, 0xc1, 0xd5, 0x9f, 0x6c, 0xd2], 0);
				data.set(int2le(amount, 32), 8);
				data.set(hex2bin(eth_wallet), 8+4);
				data.set(hex2bin(eth_signature), 8+4+20);

				let instruction = new solanaWeb3.TransactionInstruction({
					programId: program,
					keys: keys,
					data,
				});

				let transaction = new solanaWeb3.Transaction()
					.add(instructionSetUnitPrice)
					.add(instructionSetUnitLimit)
					.add(instruction);

				alert('Claiming LFG ...');
				sendTransactions([transaction], function() {
					$claim.removeAttr('disabled');
					fireConfetti();

					let lfg_received = (amount > 0?amount:conf[eth_wallet]);
					let eth_spent = spentStats.SpentEth;
					let usd_spent = spentStats.SpentUsd;

					if (typeof(eth_spent) == 'undefined')
						eth_spent = 'Unknown';

					if (typeof(usd_spent) == 'undefined')
						usd_spent = 'Unknown';

					dialog('Congratulations on your LFG tokens!','<div class="stats"><img ' +
						'src="'+metaImage.src+'" ' +
						'style="display: block;width: 100%;" />' +
						'<br />' +
						'<ul class="wallet-adapter-list">' +
							'<li><button><span>ETH Spent: <span><b>'+hrNumber(eth_spent)+'</b></span></span></button></li>' +
							'<li><button><span>USD Spent: <span><b>$'+hrNumber(usd_spent)+'</b></span></span></button></li>' +
							'<li><button><span>LFG Received: <span><b>'+hrNumber(lfg_received)+'</b></span></span></button></li>' +
						'</ul>' +
						'<br />' +
						'<form action="https://twitter.com/intent/tweet" target="_blank" method="get">' +
						'<input type="hidden" name="text" value="I wasted $'+hrNumber(usd_spent) +
							' in gas on ETH and just claimed '+hrNumber(lfg_received) +
							' $LFG. I was a real gas guzzler!" />' +
						'<input type="hidden" name="via" value="LessFnGas" />' +
						'<input type="hidden" name="hashtags" value="" />' +
						'<input type="hidden" name="url" value="'+window.location.href+'" />' +
						'<button type="submit">Share on Twitter</button></form></div>');

					conf[eth_wallet] -= (amount > 0?amount:conf[eth_wallet]);

					providerETH = false;
					provider = false;

					walletETHConnected();
					walletConnected();

				}, function() {
					$claim.removeAttr('disabled');

					providerETH = false;
					provider = false;

					walletETHConnected();
					walletConnected();
				});
			})
			.catch(function(err) {
				$claim.removeAttr('disabled');

				console.log(err);
				alert((err && err.message?err.message:JSON.stringify(err)), 'error');
			});
		},

		sagaClaim: function(sol_wallet) {
			$saga_claim.attr('disabled', '');

			let program = new solanaWeb3.PublicKey(PROGRAM);
			let config = new solanaWeb3.PublicKey(CONFIG);
			let authority = programAuthority(config, PROGRAM)[0];
			let token = new solanaWeb3.PublicKey(confToken);
			let wallet = provider.publicKey;
			let from_account = accountAddress(confToken, authority)[0];
			let to_account = accountAddress(confToken, wallet)[0];
			let sagacoll = nftMeta(confSaga)[0];
			let saganft = new solanaWeb3.PublicKey(sagaNft);
			let sagameta = nftMeta(saganft)[0];
			let sagatoken = accountAddress(saganft, wallet)[0];

			let budgetKeys = [
				{ pubkey: COMPUTE_BUDGET_PROGRAM, isWritable: false, isSigner: false }
			];

			let dataUnitPrice = new Uint8Array([
				0x03, 0x40, 0x1f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

			let instructionSetUnitPrice = new solanaWeb3.TransactionInstruction({
				programId: COMPUTE_BUDGET_PROGRAM,
				keys: budgetKeys,
				data: dataUnitPrice,
			});

			let dataUnitLimit = new Uint8Array([
				0x02, 0x40, 0x42, 0x0F, 0x00]);

			let instructionSetUnitLimit = new solanaWeb3.TransactionInstruction({
				programId: COMPUTE_BUDGET_PROGRAM,
				keys: budgetKeys,
				data: dataUnitLimit,
			});

			let keys = [
				{ pubkey: wallet, isWritable: true, isSigner: true },
				{ pubkey: config, isWritable: true, isSigner: false },
				{ pubkey: authority, isWritable: true, isSigner: false },
				{ pubkey: token, isWritable: true, isSigner: false },
				{ pubkey: from_account, isWritable: true, isSigner: false },
				{ pubkey: to_account, isWritable: true, isSigner: false },
				{ pubkey: TOKEN_PROGRAM, isWritable: false, isSigner: false },
				{ pubkey: ASSOCIATED_TOKEN_PROGRAM, isWritable: false, isSigner: false },
				{ pubkey: sagacoll, isWritable: false, isSigner: false },
				{ pubkey: saganft, isWritable: false, isSigner: false },
				{ pubkey: sagameta, isWritable: false, isSigner: false },
				{ pubkey: sagatoken, isWritable: false, isSigner: false },
				{ pubkey: SYSTEM_PROGRAM, isWritable: false, isSigner: false },
			];

			let data = new Uint8Array([
				0xe6, 0xeb, 0x7b, 0x62, 0x53, 0x68, 0x24, 0xa3]);

			let instruction = new solanaWeb3.TransactionInstruction({
				programId: program,
				keys: keys,
				data,
			});

			let transaction = new solanaWeb3.Transaction()
				.add(instructionSetUnitPrice)
				.add(instructionSetUnitLimit)
				.add(instruction);

			alert('Claiming LFG ...');
			sendTransactions([transaction], function() {
				$saga_claim.removeAttr('disabled');
				fireConfetti();

				dialog('Congratulations on your LFG tokens!','<div class="stats"><img ' +
					'src="'+metaImage.src+'" ' +
					'style="display: block;width: 100%;" />' +
					'<br />' +
					'<ul class="wallet-adapter-list">' +
						'<li><button><span>LFG Received: <span><b>'+hrNumber(confAmount)+'</b></span></span></button></li>' +
					'</ul>' +
					'<br />' +
					'<form action="https://twitter.com/intent/tweet" target="_blank" method="get">' +
					'<input type="hidden" name="text" value="I just claimed '+hrNumber(confAmount) +
						' $LFG with my Saga phone. Did you claim yours?" />' +
					'<input type="hidden" name="via" value="LessFnGas" />' +
					'<input type="hidden" name="hashtags" value="" />' +
					'<input type="hidden" name="url" value="'+window.location.href+'" />' +
					'<button type="submit">Share on Twitter</button></form></div>');

				conf[bin2hex((new solanaWeb3.PublicKey(sol_wallet)).toBytes())] = confAmount;

				provider = false;
				sagaWalletConnected();

			}, function() {
				$saga_claim.removeAttr('disabled');

				provider = false;
				sagaWalletConnected();
			});
		},
	};

	var nftMeta = function(nft) {
		return solanaWeb3.PublicKey.findProgramAddressSync(
			[
				new TextEncoder().encode('metadata'),
				(new solanaWeb3.PublicKey(METADATA_PROGRAM)).toBuffer(),
				(new solanaWeb3.PublicKey(nft)).toBuffer()
			],
			new solanaWeb3.PublicKey(METADATA_PROGRAM));
	}

	var programAuthority = function(config, program) {
		return solanaWeb3.PublicKey.findProgramAddressSync(
			[
				new TextEncoder().encode('authority'),
				(new solanaWeb3.PublicKey(config)).toBuffer()
			],
			new solanaWeb3.PublicKey(program));
	}

	var accountAddress = function(mint, owner) {
		return solanaWeb3.PublicKey.findProgramAddressSync(
			[
				(new solanaWeb3.PublicKey(owner)).toBuffer(),
				(new solanaWeb3.PublicKey(TOKEN_PROGRAM)).toBuffer(),
				(new solanaWeb3.PublicKey(mint)).toBuffer()
			],
			new solanaWeb3.PublicKey(ASSOCIATED_TOKEN_PROGRAM));
	}

	var sendTransactions = function(transactions, successCallback, errorCallback) {
		if (!transactions || !transactions.length)
			return;

		if (!connection)
			connection = new solanaWeb3.Connection(rpc);

		connection.getLatestBlockhash().then(function(obj) {
			let trans = [];
			let recentBlockhash = obj.blockhash;
			let feePayer = provider.publicKey;

			for(var i = 0; i < transactions.length; i++) {
				if (!transactions[i].recentBlockhash)
					transactions[i].recentBlockhash = recentBlockhash;

				if (!transactions[i].feePayer)
					transactions[i].feePayer = feePayer;

				trans.push(transactions[i]);
			}

			let signingFunction = 'signAllTransactions';

			if (typeof(provider.signAllTransactions) == 'undefined') {
				if (trans.length > 1)
					alert('Wallet does not support multi transaction signing! Only first transaction will be processed.');

				signingFunction = 'signTransaction';
				trans = transactions[0];
			}

			provider[signingFunction](trans, (provider.isBackpack?undefined:connection)).then(function(obj) {
				try {
					if (!obj.length && obj.data && obj.data.signatures && obj.data.signatures.length) {
						let convertedObj = [];

						for (var i = 0; i < obj.data.signatures.length; i++) {
							convertedObj.push({
								signatures: [{
									publicKey: obj.data.publicKey,
									signature: obj.data.signatures[i]
								}]
							});
						}
						obj = convertedObj;
					}
				} catch(e) {}

				try {
					if (!obj.length && obj.signatures && obj.signatures.length)
						obj = [obj];
				} catch(e) {}

				if (!obj.length) {
					console.log(obj);
					alert('Error: '+parseError(obj && obj.msg?obj.msg:JSON.stringify(obj)), 'error');

					if (typeof(errorCallback) == 'function')
						errorCallback(obj, true);

					return;
				}

				alert('Sending transactions ...');

				for(let i = 0; i < transactions.length; i++) {
					if (!obj[i].signatures || !obj[i].signatures.length) {
						alert('Error: No signature for transaction #'+(i+1), 'error');
						continue;
					}

					let transaction = obj[i];

					connection.sendRawTransaction(transaction.serialize(), {skipPreflight: true}).then(function(obj) {
						alert('<a href="https://solana.fm/tx/'+obj+'" target="_blank">'+obj+'</a>');

						connection.confirmTransaction(obj).then(function(obj) {
							if (obj.value && obj.value.err) {
								alert('Error: '+parseError(obj.value.err.message?obj.value.err.message:JSON.stringify(obj.value.err)), 'error');

								if (typeof(errorCallback) == 'function') {
									if (errorCallback(obj, i) === true)
										return;
								}
							} else {
								alert('Transaction successfully completed.', 'success');

								if (typeof(successCallback) == 'function') {
									if (successCallback(obj, i) === true)
										return;
								}
							}
						})
						.catch(function(err) {
							console.log(err);
							alert('Error: '+parseError(err && err.message?err.message:JSON.stringify(err)), 'error');

							if (typeof(errorCallback) == 'function') {
								if (errorCallback(err, i) === true)
									return;
							}
						});
					})
					.catch(function(err) {
						console.log(err);
						alert('Error: '+parseError(err && err.message?err.message:JSON.stringify(err)), 'error');

						if (typeof(errorCallback) == 'function') {
							if (errorCallback(err, i) === true)
								return;
						}
					});
				}
			})
			.catch(function(err) {
				console.log(err);
				alert((err && err.message?err.message:JSON.stringify(err)), 'error');

				if (typeof(errorCallback) == 'function') {
					if (errorCallback(err, true) === true)
						return;
				}
			});

		})
		.catch(function(err) {
			console.log(err);
			alert((err && err.message?err.message:JSON.stringify(err)), 'error');

			if (typeof(errorCallback) == 'function') {
				if (errorCallback(err, true) === true)
					return;
			}
		});
	}

	var switchRpc = function() {
		if (!RPC || RPC.length < 2)
			return;

		for(var i in RPC) {
			if (RPC[i] == rpc) {
				if (RPC[parseInt(i+1)])
					rpc = RPC[parseInt(i+1)];
				else
					rpc = RPC[0];

				break;
			}
		}

		connection = new solanaWeb3.Connection(rpc);
	}

	var fetchConf = function() {
		conf = true;
		loader(true, 'Loading config ...');

		if (!connection)
			connection = new solanaWeb3.Connection(rpc);

		connection.getAccountInfo(new solanaWeb3.PublicKey(CONFIG))
		.then(function(obj) {
			if (!obj || !obj.data || !obj.data.length)
				throw new Error(CONFIG+': Not exists.');

			var offset = 8;
			var claimed = 0;

			var size = new Uint32Array((new Uint8Array(obj.data.slice(offset, offset+4))).buffer)[0]; offset += 4+size;
			confToken = new solanaWeb3.PublicKey(obj.data.slice(offset, offset+32)); offset += 32;
			confSuspended = obj.data[0];
			confCustomAmounts = obj.data[1];

			for(var i = 0; i < obj.data.length; i += 20+4) {
				let wallet = bin2hex(obj.data.slice(offset, offset+20)); offset += 20;
				var amount = new Uint32Array((new Uint8Array(obj.data.slice(offset, offset+4))).buffer)[0]; offset += 4;

				if (wallet.length == 42 && wallet != '0x0000000000000000000000000000000000000000') {
					if (conf === true)
						conf = {};

					conf[wallet] = amount;

					if (amount === 0)
						claimed++;
				}
			}

			if (conf === true)
				throw new Error('Empty config: '+CONFIG);

			console.log('Claims: '+claimed+' / '+Object.keys(conf).length);

			loader(false);
			walletETHConnected();
		})
		.catch(function(err) {
			conf = false;
			loader(false);
			console.log(err);
			alert((err && err.message?err.message:JSON.stringify(err))+"\r\nPlease try again.", 'error');
		});
	}

	var sagaFetchConf = function() {
		conf = true;
		loader(true, 'Loading config ...');

		if (!connection)
			connection = new solanaWeb3.Connection(rpc);

		connection.getAccountInfo(new solanaWeb3.PublicKey(CONFIG))
		.then(function(obj) {
			if (!obj || !obj.data || !obj.data.length)
				throw new Error(CONFIG+': Not exists.');

			var offset = 8;

			var size = new Uint32Array((new Uint8Array(obj.data.slice(offset, offset+4))).buffer)[0]; offset += 4+size;
			confToken = new solanaWeb3.PublicKey(obj.data.slice(offset, offset+32)); offset += 32;
			confSaga = new solanaWeb3.PublicKey(obj.data.slice(offset, offset+32)); offset += 32;
			confAmount = new Uint32Array((new Uint8Array(obj.data.slice(offset, offset+4))).buffer)[0]; offset += 4;
			confSuspended = obj.data[0];

			for(var i = 0; i < obj.data.length; i += 32+4) {
				let wallet = bin2hex(obj.data.slice(offset, offset+32)); offset += 32;
				var amount = new Uint32Array((new Uint8Array(obj.data.slice(offset, offset+4))).buffer)[0]; offset += 4;

				if (wallet.length == 66 && wallet != '0x0000000000000000000000000000000000000000000000000000000000000000') {
					if (conf === true)
						conf = {};

					conf[wallet] = amount;
				}
			}

			if (conf === true)
				conf = {};

			console.log('Claims: '+Object.keys(conf).length);

			sagaFetchNfts();

			if (nfts !== true && metas !== true)
				loader(false);

			sagaWalletConnected();
		})
		.catch(function(err) {
			conf = false;
			loader(false);
			console.log(err);
			alert((err && err.message?err.message:JSON.stringify(err))+"\r\nPlease try again.", 'error');
			switchRpc();
		});
	}

	var sagaFetchNfts = function() {
		if (conf && conf != true && typeof(conf[bin2hex(provider.publicKey.toBytes())]) != 'undefined')
			return;

		nfts = true;
		metas = false;
		sagaNft = undefined;
		loader(true, 'Loading NFTs ...');

		if (!connection)
			connection = new solanaWeb3.Connection(rpc);

		connection.getParsedTokenAccountsByOwner(provider.publicKey, {
	    	programId: new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
		})
		.then(function(obj) {
			if (!obj.value || !obj.value.length)
				throw new Error('No tokens found.');

			var pubkey = provider.publicKey.toBase58();

			for(var i in obj.value) {
				var nft = obj.value[i].account.data.parsed.info.mint;
				var owner = obj.value[i].account.data.parsed.info.owner;

				if (owner == pubkey && obj.value[i].account.data.parsed.info.tokenAmount.amount == 1) {
					if (nfts === true)
						nfts = {};

					nfts[nft] = nftMeta(nft)[0];
				}
			}

			if (nfts === true)
				nfts = {};

			console.log('NFTs: ', nfts);
			sagaFetchMetas();

			if (conf !== true && metas !== true)
				loader(false);

			sagaWalletConnected();
		})
		.catch(function(err) {
			nfts = false;
			loader(false);
			console.log(err);
			alert((err && err.message?err.message:JSON.stringify(err))+"\r\nPlease try again.", 'error');
			switchRpc();
		});
	}

	var sagaFetchMetas = function() {
		metas = true;
		sagaNft = undefined;
		loader(true, 'Checking Saga NFT ...');

		if (!connection)
			connection = new solanaWeb3.Connection(rpc);

		let find = function(haystack, needle) {
			for(var i = haystack.length-needle.length; i >= 0; i--) {
				var e = 0;

				for(var j = 0; j < needle.length; j++) {
					if (haystack[i+j] !== needle[j])
						break;

					e++;
				}

				if (e == needle.length)
					return true;
			}

			return false;
		}

		let tries = {};
		let saga = [1,0,1,1];
		saga.push(...(new solanaWeb3.PublicKey(confSaga)).toBytes());

		let all_mints = Object.keys(nfts);
		let all_accounts = Object.values(nfts);

		let fetch = function(start) {
			if (!start)
				start = 0;

			if (!tries[start])
				tries[start] = 0;

			if (all_mints.length > 100)
				loader(true, 'Checking Saga NFT '+(start+100 <= all_mints.length?start+100:all_mints.length) +' / '+all_mints.length+' ...');

			let mints = all_mints.slice(start, start+100);
			let accounts = all_accounts.slice(start, start+100);

			if (!mints.length) {
				console.log('Metas: ', metas);
				console.log(sagaNft);

				if (!sagaNft)
					sagaNft = false;

				if (metas === true)
					metas = {};

				if (conf !== true && nfts !== true)
					loader(false);

				sagaWalletConnected();
				return;
			}

			connection.getMultipleAccountsInfo(accounts)
			.then(function(obj) {
				if (!obj || !obj.length)
					throw new Error('No metadatas found.');

				for(var i in obj) {
					var nft = mints[i];

					if (metas === true)
						metas = {};

					metas[nft] = true;

					if (obj[i] && obj[i].data && find(obj[i].data, saga)) {
						sagaNft = nft;
					}
				}

				fetch(start+100);
			})
			.catch(function(err) {
				console.log(err);

				if (tries[start] < 3) {
					tries[start]++;
					fetch(start);

				} else {
					nfts = false;
					metas = false;
					loader(false);
					alert((err && err.message?err.message:JSON.stringify(err))+"\r\nPlease try again.", 'error');
				}
			});
		}

		fetch(0);
	}

	var dialog = function (title, content) {
		let $dialog = 
		  $('<div class="dialog"><div class="dialog-backdrop" aria-hidden="true" style="opacity: 0;"></div><div tabindex="0"></div><div class="dialog-container"><div class="dialog-paper in"><div class="dialog-title">' +
			'<h2>'+title+'<button><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path></svg></button></h2>' +
			'</div><div class="dialog-content">' +
			content +
			'</div></div></div></div>');

		$dialog.find('.dialog-title button').click(function() { 
			$dialog.find('.dialog-backdrop').css('opacity', 0);
			$dialog.find('.dialog-paper').addClass('out');

			setTimeout(function() {
				$dialog.remove();
			}, 500);

			alert(false);
		});

		$('body').append($dialog);

		setTimeout(function() {
			$dialog.find('.dialog-backdrop').css('opacity', 1);
			$dialog.find('.dialog-paper').removeClass('in');
		}, 100);

		return $dialog;
	}

	var alert = function (content, type, sticky, onclose) {
		let $alert = $('#alert');

		if (content === false)
			return $alert.find('.alert-action button').click();

		if (!type || type == 'info')
			type = 'alert-info';
		else if (type == 'warning')
			type = 'alert-warning';
		else if (type == 'error')
			type = 'alert-error';
		else if (type == 'success')
			type = 'alert-success';

		if ($alert.length) {
			var $type = $alert.find('.alert-container');
			var $message = $alert.find('.alert-message');
			var message = $message.get(0);

			if (type != 'alert-info') {
				$type.attr('class', 'alert-container');
				$type.addClass(type);
			}

			if (sticky)
				$message.html(content);
			else
				$message.append("\r\n"+content);

			if (!message.dataset.height || message.scrollHeight > message.dataset.height) {
				message.scrollTop = message.scrollHeight;
				message.dataset.height = message.scrollHeight;
			}

			clearTimeout(alertTimeout);

			if (!sticky && !$type.is('.alert-info')) {
				alertTimeout = setTimeout(function() {
					$alert.find('.alert-action button').click();
				}, 6000);
			}

			return;
		}

		$alert = 
		  $('<div class="alert" id="alert">' +
			'<div class="alert-container '+type+'" role="alert" style="opacity: 0; transform: scale(0); transition: opacity 225ms cubic-bezier(0.4, 0, 0.2, 1) 0ms, transform 150ms cubic-bezier(0.4, 0, 0.2, 1) 0ms;" direction="up">' +
			'<div class="alert-icon"><svg focusable="false" viewBox="0 0 24 24" aria-hidden="true">' +
			(type == 'alert-success'?
				'<path d="M20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4C12.76,4 13.5,4.11 14.2, 4.31L15.77,2.74C14.61,2.26 13.34,2 12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0, 0 22,12M7.91,10.08L6.5,11.5L11,16L21,6L19.59,4.58L11,13.17L7.91,10.08Z"></path>':
				(type == 'alert-error'?
					'<path d="M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"></path>':
					(type == 'alert-warning'?
						'<path d="M12 5.99L19.53 19H4.47L12 5.99M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z"></path>':
						'<path d="M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20, 12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10, 10 0 0,0 12,2M11,17H13V11H11V17Z"></path>'))) +
			'</svg>' +
			'</div>' +
			'<div class="alert-message">'+content+'</div>' +
			'<div class="alert-action"><button title="Close"><span>' +
				'<svg focusable="false" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path>' +
			'</svg></span></button></div></div></div>');

		$alert.find('.alert-action button').click(function() {
			if (typeof(onclose) == 'function')
				onclose.call();

			$alert.find('.alert-container').css('opacity', '0').css('transform', 'scale(0)');
			setTimeout(function() {
				$alert.remove();
			}, 225);
		});

		$('body').append($alert);

		var message = $alert.find('.alert-message').get(0);
		message.scrollTop = message.scrollHeight;
		message.dataset.height = message.scrollHeight;

		setTimeout(function() {
			$alert.find('.alert-container').css('opacity', '1').css('transform', 'none');
		}, 100);

		clearTimeout(alertTimeout);

		if (!sticky && type != 'alert-info') {
			alertTimeout = setTimeout(function() {
				$alert.find('.alert-action button').click();
			}, 6000);
		}
	}

	var tryWallet = function(kind, connectCallback, disconnectCallback) {
		try {
			let proxy;

			if (kind == 'phantom' && typeof(phantom) != 'undefined')
				proxy = phantom.solana;
			else if (kind == 'solflare' && typeof(solflare) != 'undefined')
				proxy = solflare;
			else if (kind == 'backpack' && typeof(backpack) != 'undefined')
				proxy = backpack;
			else if (kind == 'coinbase' && typeof(coinbaseSolana) != 'undefined')
				proxy = coinbaseSolana;
			else if (kind == 'okx' && typeof(okxwallet) != 'undefined')
				proxy = okxwallet.solana;

			if (!proxy)
				throw new Error(kind.charAt(0).toUpperCase()+kind.slice(1)+' not available.');

			function connect(obj) {
				provider = proxy;

				if (typeof(connectCallback) == 'function')
					connectCallback(obj);
			}

			function disconnect(obj) {
				provider = null;

				if (typeof(disconnectCallback) == 'function')
					disconnectCallback(obj);
			}

			if (proxy.off)
				proxy.off('connect', connect).off('disconnect', disconnect).off('accountsChanged', connect);

			if (proxy.on)
				proxy.on('connect', connect).on('disconnect', disconnect).on('accountsChanged', connect);

			if (connectCallback) {
				if (proxy.isConnected) {
					connect(proxy);

				} else {
					proxy.connect().then(function(obj) {
						connect(obj);
					}).catch(function(err) {
						console.log(err);
						alert((err && err.message?err.message:JSON.stringify(err))+"\r\nPlease unlock your wallet and try again.", 'error');
					});
				}
			}

		} catch(e) { 
			console.log(e);

			if (connectCallback)
				alert((e && e.message?e.message:JSON.stringify(e))+"\r\nPlease unlock your wallet and try again.", 'error');

			if (!providersTries[kind])
				providersTries[kind] = 0;

			providersTries[kind]++;

			if (providersTries[kind] <= 3 && !connectCallback)
				setTimeout(function() { tryWallet(kind, connectCallback, disconnectCallback); }, 1000);
		}
	}

	var tryETHWallet = function(kind, connectCallback, disconnectCallback) {
		try {
			let proxy;

			if (kind == 'phantom' && typeof(phantom) != 'undefined')
				proxy = phantom.ethereum;
			else if (kind == 'metamask' && typeof(metamask) == 'undefined')
				proxy = getETHProvider('MetaMask');
			else if (kind == 'coinbase' && typeof(coinbase) == 'undefined')
				proxy = getETHProvider('CoinbaseWallet');
			else if (kind == 'okx' && typeof(okxwallet) != 'undefined')
				proxy = okxwallet;

			if (!proxy)
				throw new Error(kind.charAt(0).toUpperCase()+kind.slice(1)+' not available.');

			function connect(obj) {
				providerETH = proxy;

				if (!providerETH.selectedAddress && typeof(obj[0]) != 'undefined')
					providerETH.selectedAddress = obj[0];

				if (typeof(connectCallback) == 'function')
					connectCallback(obj);
			}

			function disconnect(obj) {
				providerETH = null;

				if (typeof(disconnectCallback) == 'function')
					disconnectCallback(obj);
			}

			if (proxy.off)
				proxy.off('connect', connect).off('disconnect', disconnect).off('accountsChanged', connect);

			if (proxy.on)
				proxy.on('connect', connect).on('disconnect', disconnect).on('accountsChanged', connect);

			if (connectCallback) {
				proxy.request({method: "eth_requestAccounts", params: []}).then(function(obj) {
					connect(obj);
				}).catch(function(err) {
					console.log(err);
					alert((err && err.message?err.message:JSON.stringify(err))+"\r\nPlease unlock your wallet and try again.", 'error');
				});
			}

		} catch(e) { 
			console.log(e);

			if (connectCallback)
				alert((e && e.message?e.message:JSON.stringify(e))+"\r\nPlease unlock your wallet and try again.", 'error');

			if (!providersTries[kind+'ETH'])
				providersTries[kind+'ETH'] = 0;

			providersTries[kind+'ETH']++;

			if (providersTries[kind+'ETH'] <= 3 && !connectCallback)
				setTimeout(function() { tryETHWallet(kind, connectCallback, disconnectCallback); }, 1000);
		}
	}

	var getETHProvider = function(kind) {
		if (typeof(ethereum) == 'undefined')
			return;

		if (typeof(ethereum.providers) == 'undefined')
			ethereum.providers = [ethereum];

		for(var i in ethereum.providers) {
			var provider = ethereum.providers[i];

			if (provider.selectedProvider)
				provider = provider.selectedProvider;
			else if (provider.providers)
				provider = provider.providers[0];

			if (provider['is'+kind] && !provider['overrideIs'+kind])
				return provider;
		}
	}

	var init = function(connectCallback, disconnectCallback) {
		setTimeout(function() {
			if (typeof(phantom) != 'undefined') {
				tryWallet('phantom', connectCallback, disconnectCallback);
				tryETHWallet('phantom', connectCallback, disconnectCallback);
			}

			if (typeof(solflare) != 'undefined')
				tryWallet('solflare', connectCallback, disconnectCallback);

			if (typeof(backpack) != 'undefined')
				tryWallet('backpack', connectCallback, disconnectCallback);

			if (typeof(coinbaseSolana) != 'undefined')
				tryWallet('coinbase', connectCallback, disconnectCallback);

			if (typeof(metmask) != 'undefined')
				tryETHWallet('metamask', connectCallback, disconnectCallback);

			if (typeof(coinbase) != 'undefined')
				tryETHWallet('coinbase', connectCallback, disconnectCallback);

			if (typeof(okxwallet) != 'undefined') {
				tryWallet('okx', connectCallback, disconnectCallback);
				tryETHWallet('okx', connectCallback, disconnectCallback);
			}
		}, 100);
	}

	var pick = function() {
		let $dialog = dialog('Select SOL Wallet',
			'<ul class="wallet-adapter-list">' +
				'<li>' +
					'<button data-type="phantom">' +
						'<span>' +
							'Phantom' +
							'<span>' +
								'<img src="data:image/svg+xml;base64,PHN2ZyBmaWxsPSJub25lIiBoZWlnaHQ9IjM0IiB3aWR0aD0iMzQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGxpbmVhckdyYWRpZW50IGlkPSJhIiB4MT0iLjUiIHgyPSIuNSIgeTE9IjAiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiM1MzRiYjEiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiM1NTFiZjkiLz48L2xpbmVhckdyYWRpZW50PjxsaW5lYXJHcmFkaWVudCBpZD0iYiIgeDE9Ii41IiB4Mj0iLjUiIHkxPSIwIiB5Mj0iMSI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjZmZmIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjZmZmIiBzdG9wLW9wYWNpdHk9Ii44MiIvPjwvbGluZWFyR3JhZGllbnQ+PGNpcmNsZSBjeD0iMTciIGN5PSIxNyIgZmlsbD0idXJsKCNhKSIgcj0iMTciLz48cGF0aCBkPSJtMjkuMTcwMiAxNy4yMDcxaC0yLjk5NjljMC02LjEwNzQtNC45NjgzLTExLjA1ODE3LTExLjA5NzUtMTEuMDU4MTctNi4wNTMyNSAwLTEwLjk3NDYzIDQuODI5NTctMTEuMDk1MDggMTAuODMyMzctLjEyNDYxIDYuMjA1IDUuNzE3NTIgMTEuNTkzMiAxMS45NDUzOCAxMS41OTMyaC43ODM0YzUuNDkwNiAwIDEyLjg0OTctNC4yODI5IDEzLjk5OTUtOS41MDEzLjIxMjMtLjk2MTktLjU1MDItMS44NjYxLTEuNTM4OC0xLjg2NjF6bS0xOC41NDc5LjI3MjFjMCAuODE2Ny0uNjcwMzggMS40ODQ3LTEuNDkwMDEgMS40ODQ3LS44MTk2NCAwLTEuNDg5OTgtLjY2ODMtMS40ODk5OC0xLjQ4NDd2LTIuNDAxOWMwLS44MTY3LjY3MDM0LTEuNDg0NyAxLjQ4OTk4LTEuNDg0Ny44MTk2MyAwIDEuNDkwMDEuNjY4IDEuNDkwMDEgMS40ODQ3em01LjE3MzggMGMwIC44MTY3LS42NzAzIDEuNDg0Ny0xLjQ4OTkgMS40ODQ3LS44MTk3IDAtMS40OS0uNjY4My0xLjQ5LTEuNDg0N3YtMi40MDE5YzAtLjgxNjcuNjcwNi0xLjQ4NDcgMS40OS0xLjQ4NDcuODE5NiAwIDEuNDg5OS42NjggMS40ODk5IDEuNDg0N3oiIGZpbGw9InVybCgjYikiLz48L3N2Zz4K" alt="Phantom icon" width="24" height="24">' +
							'</span>' +
						'</span>' +
					'</button>' +
				'</li>' +
				'<li>' +
					'<button data-type="solflare">' +
						'<span>' +
							'Solflare' +
							'<span>' +
								'<img src="data:image/svg+xml;base64,PHN2ZyBmaWxsPSJub25lIiBoZWlnaHQ9IjUwIiB2aWV3Qm94PSIwIDAgNTAgNTAiIHdpZHRoPSI1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayI+PGxpbmVhckdyYWRpZW50IGlkPSJhIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNmZmMxMGIiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNmYjNmMmUiLz48L2xpbmVhckdyYWRpZW50PjxsaW5lYXJHcmFkaWVudCBpZD0iYiIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIHgxPSI2LjQ3ODM1IiB4Mj0iMzQuOTEwNyIgeGxpbms6aHJlZj0iI2EiIHkxPSI3LjkyIiB5Mj0iMzMuNjU5MyIvPjxyYWRpYWxHcmFkaWVudCBpZD0iYyIgY3g9IjAiIGN5PSIwIiBncmFkaWVudFRyYW5zZm9ybT0ibWF0cml4KDQuOTkyMTg4MzIgMTIuMDYzODc5NjMgLTEyLjE4MTEzNjU1IDUuMDQwNzEwNzQgMjIuNTIwMiAyMC42MTgzKSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIHI9IjEiIHhsaW5rOmhyZWY9IiNhIi8+PHBhdGggZD0ibTI1LjE3MDggNDcuOTEwNGMuNTI1IDAgLjk1MDcuNDIxLjk1MDcuOTQwM3MtLjQyNTcuOTQwMi0uOTUwNy45NDAyLS45NTA3LS40MjA5LS45NTA3LS45NDAyLjQyNTctLjk0MDMuOTUwNy0uOTQwM3ptLTEuMDMyOC00NC45MTU2NWMuNDY0Ni4wMzgzNi44Mzk4LjM5MDQuOTAyNy44NDY4MWwxLjEzMDcgOC4yMTU3NGMuMzc5OCAyLjcxNDMgMy42NTM1IDMuODkwNCA1LjY3NDMgMi4wNDU5bDExLjMyOTEtMTAuMzExNThjLjI3MzMtLjI0ODczLjY5ODktLjIzMTQ5Ljk1MDcuMDM4NTEuMjMwOS4yNDc3Mi4yMzc5LjYyNjk3LjAxNjEuODgyNzdsLTkuODc5MSAxMS4zOTU4Yy0xLjgxODcgMi4wOTQyLS40NzY4IDUuMzY0MyAyLjI5NTYgNS41OTc4bDguNzE2OC44NDAzYy40MzQxLjA0MTguNzUxNy40MjM0LjcwOTMuODUyNC0uMDM0OS4zNTM3LS4zMDc0LjYzOTUtLjY2MjguNjk0OWwtOS4xNTk0IDEuNDMwMmMtMi42NTkzLjM2MjUtMy44NjM2IDMuNTExNy0yLjEzMzkgNS41NTc2bDMuMjIgMy43OTYxYy4yNTk0LjMwNTguMjE4OC43NjE1LS4wOTA4IDEuMDE3OC0uMjYyMi4yMTcyLS42NDE5LjIyNTYtLjkxMzguMDIwM2wtMy45Njk0LTIuOTk3OGMtMi4xNDIxLTEuNjEwOS01LjIyOTctLjI0MTctNS40NTYxIDIuNDI0M2wtLjg3NDcgMTAuMzk3NmMtLjAzNjIuNDI5NS0uNDE3OC43NDg3LS44NTI1LjcxMy0uMzY5LS4wMzAzLS42NjcxLS4zMDk3LS43MTcxLS42NzIxbC0xLjM4NzEtMTAuMDQzN2MtLjM3MTctMi43MTQ0LTMuNjQ1NC0zLjg5MDQtNS42NzQzLTIuMDQ1OWwtMTIuMDUxOTUgMTAuOTc0Yy0uMjQ5NDcuMjI3MS0uNjM4MDkuMjExNC0uODY4LS4wMzUtLjIxMDk0LS4yMjYyLS4yMTczNS0uNTcyNC0uMDE0OTMtLjgwNmwxMC41MTgxOC0xMi4xMzg1YzEuODE4Ny0yLjA5NDIuNDg0OS01LjM2NDQtMi4yODc2LTUuNTk3OGwtOC43MTg3Mi0uODQwNWMtLjQzNDEzLS4wNDE4LS43NTE3Mi0uNDIzNS0uNzA5MzYtLjg1MjQuMDM0OTMtLjM1MzcuMzA3MzktLjYzOTQuNjYyNy0uNjk1bDkuMTUzMzgtMS40Mjk5YzIuNjU5NC0uMzYyNSAzLjg3MTgtMy41MTE3IDIuMTQyMS01LjU1NzZsLTIuMTkyLTIuNTg0MWMtLjMyMTctLjM3OTItLjI3MTMtLjk0NDMuMTEyNi0xLjI2MjEuMzI1My0uMjY5NC43OTYzLS4yNzk3IDEuMTMzNC0uMDI0OWwyLjY5MTggMi4wMzQ3YzIuMTQyMSAxLjYxMDkgNS4yMjk3LjI0MTcgNS40NTYxLTIuNDI0M2wuNzI0MS04LjU1OTk4Yy4wNDU3LS41NDA4LjUyNjUtLjk0MjU3IDEuMDczOS0uODk3Mzd6bS0yMy4xODczMyAyMC40Mzk2NWMuNTI1MDQgMCAuOTUwNjcuNDIxLjk1MDY3Ljk0MDNzLS40MjU2My45NDAzLS45NTA2Ny45NDAzYy0uNTI1MDQxIDAtLjk1MDY3LS40MjEtLjk1MDY3LS45NDAzcy40MjU2MjktLjk0MDMuOTUwNjctLjk0MDN6bTQ3LjY3OTczLS45NTQ3Yy41MjUgMCAuOTUwNy40MjEuOTUwNy45NDAzcy0uNDI1Ny45NDAyLS45NTA3Ljk0MDItLjk1MDctLjQyMDktLjk1MDctLjk0MDIuNDI1Ny0uOTQwMy45NTA3LS45NDAzem0tMjQuNjI5Ni0yMi40Nzk3Yy41MjUgMCAuOTUwNi40MjA5NzMuOTUwNi45NDAyNyAwIC41MTkzLS40MjU2Ljk0MDI3LS45NTA2Ljk0MDI3LS41MjUxIDAtLjk1MDctLjQyMDk3LS45NTA3LS45NDAyNyAwLS41MTkyOTcuNDI1Ni0uOTQwMjcuOTUwNy0uOTQwMjd6IiBmaWxsPSJ1cmwoI2IpIi8+PHBhdGggZD0ibTI0LjU3MSAzMi43NzkyYzQuOTU5NiAwIDguOTgwMi0zLjk3NjUgOC45ODAyLTguODgxOSAwLTQuOTA1My00LjAyMDYtOC44ODE5LTguOTgwMi04Ljg4MTlzLTguOTgwMiAzLjk3NjYtOC45ODAyIDguODgxOWMwIDQuOTA1NCA0LjAyMDYgOC44ODE5IDguOTgwMiA4Ljg4MTl6IiBmaWxsPSJ1cmwoI2MpIi8+PC9zdmc+" alt="Solflare icon" width="24" height="24">' +
							'</span>' +
						'</span>' +
					'</button>' +
				'</li>' +
				'<li>' +
					'<button data-type="backpack">' +
						'<span>' +
							'BackPack' +
							'<span>' +
								'<img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAyNCIgaGVpZ2h0PSIxMDI0IiB2aWV3Qm94PSIwIDAgMTAyNCAxMDI0IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8ZyBjbGlwLXBhdGg9InVybCgjY2xpcDBfNjMzMl8zMzMyNikiPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTUwNi42NzcgMTA4LjkxN0M1MzYuNzU0IDEwOC45MTcgNTYxLjEzNiA4NC41MzUxIDU2MS4xMzYgNTQuNDU4NUM1NjEuMTM2IDI0LjM4MTkgNTM2Ljc1NCAwIDUwNi42NzcgMEM0NzYuNjAxIDAgNDUyLjIxOSAyNC4zODE5IDQ1Mi4yMTkgNTQuNDU4NUM0NTIuMjE5IDg0LjUzNTEgNDc2LjYwMSAxMDguOTE3IDUwNi42NzcgMTA4LjkxN1pNNjYxLjg0NyA4MjkuOTY3QzYxNy4xNiA4MzkuMDg1IDU4My41MzggODc4LjYxMyA1ODMuNTM4IDkyNS45OTRDNTgzLjUzOCA5ODAuMTIxIDYyNy40MTcgMTAyNCA2ODEuNTQ1IDEwMjRDNzExLjE3IDEwMjQgNzM3LjcyNiAxMDEwLjg2IDc1NS42OTcgOTkwLjA4Qzc5MC4xOTIgOTUxLjIwOSA3OTcuOTcyIDk0NS44NDYgODYwLjk2NiA5NDEuOTg4QzkyMy4zMDUgOTM4LjY1MiA5NzIuODI2IDg4Ny4wNDcgOTcyLjgyNiA4MjMuODc2Qzk3Mi44MjYgNzU4LjU0OSA5MTkuODY5IDcwNS41OTIgODU0LjU0MyA3MDUuNTkyQzgxMS45MjEgNzA1LjU5MiA3NzQuNTY0IDcyOC4xMzUgNzUzLjc0NSA3NjEuOTQ5QzcyMC40NjUgODE0LjI5OSA3MTEuNzg2IDgxOC43MDMgNjYxLjg0NyA4MjkuOTY3Wk0xMDEyLjc0IDI3Ny4xMjJDMTAxMi43NCAzMjMuNzg0IDk3NC45MTQgMzYxLjYxIDkyOC4yNTIgMzYxLjYxQzkwMS41NjUgMzYxLjYxIDg3Ny43NjkgMzQ5LjIzNyA4NjIuMjg1IDMyOS45MTVMODYyLjI4NCAzMjkuOTE4QzgzMS41ODIgMjkxLjU2IDgxOC40NzcgMjgzLjI1OCA3NTMuOTcxIDI5Mi4yM0M3NDguMTk5IDI5My4xMzQgNzQyLjI4NCAyOTMuNjAyIDczNi4yNTggMjkzLjYwMkM2NzMuNDkgMjkzLjYwMiA2MjIuNjA2IDI0Mi43MTggNjIyLjYwNiAxNzkuOTVDNjIyLjYwNiAxMTcuMTgxIDY3My40OSA2Ni4yOTczIDczNi4yNTggNjYuMjk3M0M3ODAuMzcxIDY2LjI5NzMgODE4LjYxNSA5MS40Mjk3IDgzNy40NSAxMjguMTU3Qzg2OC4xNCAxODQuODM2IDg4Mi42NDUgMTkwLjYzOSA5MzEuMTQ5IDE5Mi42ODJDOTc2LjQ3IDE5NC4yMDkgMTAxMi43NCAyMzEuNDMgMTAxMi43NCAyNzcuMTIyWk0zNjUuODkzIDM4OC4wNzRDMzk4Ljg1MiAzNjQuMjI0IDQyMC4yOTUgMzI1LjQzOSA0MjAuMjk1IDI4MS42NDZDNDIwLjI5NSAyMDkuMTQxIDM2MS41MTggMTUwLjM2NCAyODkuMDEzIDE1MC4zNjRDMjE2LjUwOCAxNTAuMzY0IDE1Ny43MzEgMjA5LjE0MSAxNTcuNzMxIDI4MS42NDZDMTU3LjczMSAyODUuNDcgMTU3Ljg5NCAyODkuMjU1IDE1OC4yMTUgMjkyLjk5NkMxNjYuMTQxIDM5MS45ODMgMTU1LjY3MiA0MTcuMjIyIDcxLjMwODEgNDc2Ljk2OEMzNS4zMTkgNTAxLjcyNyAxMS43MjI3IDU0My4yMDIgMTEuNzIyNyA1OTAuMTg4QzExLjcyMjcgNjY2LjAzNCA3My4yMDc1IDcyNy41MTggMTQ5LjA1MyA3MjcuNTE4QzIyNC44OTggNzI3LjUxOCAyODYuMzgzIDY2Ni4wMzQgMjg2LjM4MyA1OTAuMTg4QzI4Ni4zODMgNTg0LjczOCAyODYuMDY2IDU3OS4zNjIgMjg1LjQ0OCA1NzQuMDc3QzI3NC44NjYgNDcxLjU4NCAyODYuODU4IDQ0Ni45MTcgMzY1Ljg5MyAzODguMDc0Wk01MTMuNjkzIDg3My43MDVDNTEzLjY5MyA5NTYuMDg5IDQ0Ni45MDggMTAyMi44NyAzNjQuNTI0IDEwMjIuODdDMjgyLjE0IDEwMjIuODcgMjE1LjM1NSA5NTYuMDg5IDIxNS4zNTUgODczLjcwNUMyMTUuMzU1IDc5MS4zMjEgMjgyLjE0IDcyNC41MzYgMzY0LjUyNCA3MjQuNTM2QzQ0Ni45MDggNzI0LjUzNiA1MTMuNjkzIDc5MS4zMjEgNTEzLjY5MyA4NzMuNzA1WiIgZmlsbD0idXJsKCNwYWludDBfbGluZWFyXzYzMzJfMzMzMjYpIi8+CjwvZz4KPGRlZnM+CjxsaW5lYXJHcmFkaWVudCBpZD0icGFpbnQwX2xpbmVhcl82MzMyXzMzMzI2IiB4MT0iMTUwLjI4NCIgeTE9IjIxMS4zMDIiIHgyPSIxMTYwLjQyIiB5Mj0iNjQ5LjYyMSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSIjM0VFQ0I4Ii8+CjxzdG9wIG9mZnNldD0iMC41MDkzMjMiIHN0b3AtY29sb3I9IiNBMzcyRkUiLz4KPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjRkU3RDRBIi8+CjwvbGluZWFyR3JhZGllbnQ+CjxjbGlwUGF0aCBpZD0iY2xpcDBfNjMzMl8zMzMyNiI+CjxyZWN0IHdpZHRoPSIxMDI0IiBoZWlnaHQ9IjEwMjQiIGZpbGw9IndoaXRlIi8+CjwvY2xpcFBhdGg+CjwvZGVmcz4KPC9zdmc+Cg==" alt="BackPack icon" width="24" height="24">' +
							'</span>' +
						'</span>' +
					'</button>' +
				'</li>' +
				'<li>' +
					'<button data-type="coinbase">' +
						'<span>' +
							'Coinbase' +
							'<span>' +
								'<img src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxuczp4b2RtPSJodHRwOi8vd3d3LmNvcmVsLmNvbS9jb3JlbGRyYXcvb2RtLzIwMDMiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHZlcnNpb249IjEuMSIgaWQ9IkxheWVyXzEiIHg9IjBweCIgeT0iMHB4IiB2aWV3Qm94PSIwIDAgMjUwMCAyNTAwIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCAyNTAwIDI1MDA7IiB4bWw6c3BhY2U9InByZXNlcnZlIj4KPHN0eWxlIHR5cGU9InRleHQvY3NzIj4KCS5zdDB7ZmlsbDpub25lO30KCS5zdDF7ZmlsbDojRkZGRkZGO30KCS5zdDJ7ZmlsbDojMDA1MkZGO30KPC9zdHlsZT4KPGcgaWQ9IkxheWVyX3gwMDIwXzEiPgoJPHJlY3QgeT0iMCIgY2xhc3M9InN0MCIgd2lkdGg9IjI1MDAiIGhlaWdodD0iMjUwMCI+PC9yZWN0PgoJPGcgaWQ9Il8xNTU2OTUxNjc1NjE2Ij4KCQk8ZyBpZD0iTGF5ZXJfeDAwMjBfMV8wIj4KCQkJPHJlY3QgeT0iMCIgY2xhc3M9InN0MCIgd2lkdGg9IjI1MDAiIGhlaWdodD0iMjUwMCI+PC9yZWN0PgoJCQk8ZyBpZD0iXzE4NDIxMzc1Mzc2OTYiPgoJCQkJPHBhdGggY2xhc3M9InN0MSIgZD0iTTEyNTAsMEwxMjUwLDBjNjkwLjIsMCwxMjUwLDU1OS44LDEyNTAsMTI1MGwwLDBjMCw2OTAuMi01NTkuOCwxMjUwLTEyNTAsMTI1MGwwLDAgICAgICBDNTU5LjgsMjUwMCwwLDE5NDAuMiwwLDEyNTBsMCwwQzAsNTU5LjgsNTU5LjgsMCwxMjUwLDB6Ij48L3BhdGg+CgkJCQk8cGF0aCBjbGFzcz0ic3QyIiBkPSJNMTI1MC40LDE2ODkuNWMtMjQyLjgsMC00MzkuNC0xOTYuNy00MzkuNC00MzkuNXMxOTYuNy00MzkuNCw0MzkuNC00MzkuNGMyMTcuNSwwLDM5OC4xLDE1OC42LDQzMi45LDM2Ni4yICAgICAgSDIxMjZjLTM3LjQtNDUxLjItNDE0LjktODA1LjctODc1LjYtODA1LjdjLTQ4NS4yLDAtODc4LjksMzkzLjctODc4LjksODc4LjlzMzkzLjcsODc4LjksODc4LjksODc4LjkgICAgICBjNDYwLjcsMCw4MzguMy0zNTQuNSw4NzUuNi04MDUuN2gtNDQzLjFDMTY0OC4xLDE1MzAuOSwxNDY3LjksMTY4OS41LDEyNTAuNCwxNjg5LjVMMTI1MC40LDE2ODkuNXoiPjwvcGF0aD4KCQkJPC9nPgoJCTwvZz4KCTwvZz4KPC9nPgo8L3N2Zz4K" alt="Coinbase icon" width="24" height="24">' +
							'</span>' +
						'</span>' +
					'</button>' +
				'</li>' +
				'<li>' +
					'<button data-type="okx">' +
						'<span>' +
							'OKX' +
							'<span>' +
								'<img src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxuczp4b2RtPSJodHRwOi8vd3d3LmNvcmVsLmNvbS9jb3JlbGRyYXcvb2RtLzIwMDMiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHZlcnNpb249IjEuMSIgaWQ9IkxheWVyXzEiIHg9IjBweCIgeT0iMHB4IiB2aWV3Qm94PSIwIDAgMjUwMCAyNTAwIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCAyNTAwIDI1MDA7IiB4bWw6c3BhY2U9InByZXNlcnZlIj4KPHN0eWxlIHR5cGU9InRleHQvY3NzIj4KCS5zdDB7ZmlsbC1ydWxlOmV2ZW5vZGQ7Y2xpcC1ydWxlOmV2ZW5vZGQ7fQoJLnN0MXtmaWxsOiNGRkZGRkY7fQo8L3N0eWxlPgo8ZyBpZD0iTGF5ZXJfeDAwMjBfMSI+Cgk8ZyBpZD0iXzIxODczODEzMjM4NTYiPgoJCTxyZWN0IHk9IjAiIGNsYXNzPSJzdDAiIHdpZHRoPSIyNTAwIiBoZWlnaHQ9IjI1MDAiPjwvcmVjdD4KCQk8Zz4KCQkJPHBhdGggY2xhc3M9InN0MSIgZD0iTTE0NjMsMTAxNWgtNDA0Yy0xNywwLTMxLDE0LTMxLDMxdjQwNGMwLDE3LDE0LDMxLDMxLDMxaDQwNGMxNywwLDMxLTE0LDMxLTMxdi00MDQgICAgIEMxNDk0LDEwMjksMTQ4MCwxMDE1LDE0NjMsMTAxNXoiPjwvcGF0aD4KCQkJPHBhdGggY2xhc3M9InN0MSIgZD0iTTk5Niw1NDlINTkyYy0xNywwLTMxLDE0LTMxLDMxdjQwNGMwLDE3LDE0LDMxLDMxLDMxaDQwNGMxNywwLDMxLTE0LDMxLTMxVjU4MEMxMDI3LDU2MywxMDEzLDU0OSw5OTYsNTQ5eiI+PC9wYXRoPgoJCQk8cGF0aCBjbGFzcz0ic3QxIiBkPSJNMTkzMCw1NDloLTQwNGMtMTcsMC0zMSwxNC0zMSwzMXY0MDRjMCwxNywxNCwzMSwzMSwzMWg0MDRjMTcsMCwzMS0xNCwzMS0zMVY1ODAgICAgIEMxOTYxLDU2MywxOTQ3LDU0OSwxOTMwLDU0OXoiPjwvcGF0aD4KCQkJPHBhdGggY2xhc3M9InN0MSIgZD0iTTk5NiwxNDgySDU5MmMtMTcsMC0zMSwxNC0zMSwzMXY0MDRjMCwxNywxNCwzMSwzMSwzMWg0MDRjMTcsMCwzMS0xNCwzMS0zMXYtNDA0ICAgICBDMTAyNywxNDk2LDEwMTMsMTQ4Miw5OTYsMTQ4MnoiPjwvcGF0aD4KCQkJPHBhdGggY2xhc3M9InN0MSIgZD0iTTE5MzAsMTQ4MmgtNDA0Yy0xNywwLTMxLDE0LTMxLDMxdjQwNGMwLDE3LDE0LDMxLDMxLDMxaDQwNGMxNywwLDMxLTE0LDMxLTMxdi00MDQgICAgIEMxOTYxLDE0OTYsMTk0NywxNDgyLDE5MzAsMTQ4MnoiPjwvcGF0aD4KCQk8L2c+Cgk8L2c+CjwvZz4KPC9zdmc+Cg==" alt="OKX icon" width="24" height="24">' +
							'</span>' +
						'</span>' +
					'</button>' +
				'</li>' +
				(provider && provider.publicKey?
				'<li>' +
					'<button>' +
						'Disconnect' +
					'</button>' +
				'</li>':'') +
				'</ul>');

		$dialog.find('.dialog-content button').click(function() {
			let $this = $(this);
			let adapterType = $this.data('type');

			let connect = function() {
				try {
					if (adapterType) {
						if ($('#saga_claim_dialog').is(':visible'))
							tryWallet(adapterType, sagaWalletConnected, sagaWalletConnected);
						else
							tryWallet(adapterType, walletConnected, walletConnected);

					} else if (!adapterType) {
						if (provider && provider.disconnect)
							provider.disconnect();

						if (provider && provider.emit)
							provider.emit('disconnect');
					}

				} catch(e) {
					alert(e.message, 'error');
				}
			}

			$dialog.find('.dialog-title button').click();

			setTimeout(function() {
				connect();
			}, 300);
		});
	}

	var pickETH = function() {
		let $dialog = dialog('Select ETH Wallet',
			'<ul class="wallet-adapter-list">' +
				(typeof(okxwallet) != 'undefined'?
				'<li>' +
					'<button data-type="okx">' +
						'<span>' +
							'OKX' +
							'<span>' +
								'<img src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxuczp4b2RtPSJodHRwOi8vd3d3LmNvcmVsLmNvbS9jb3JlbGRyYXcvb2RtLzIwMDMiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHZlcnNpb249IjEuMSIgaWQ9IkxheWVyXzEiIHg9IjBweCIgeT0iMHB4IiB2aWV3Qm94PSIwIDAgMjUwMCAyNTAwIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCAyNTAwIDI1MDA7IiB4bWw6c3BhY2U9InByZXNlcnZlIj4KPHN0eWxlIHR5cGU9InRleHQvY3NzIj4KCS5zdDB7ZmlsbC1ydWxlOmV2ZW5vZGQ7Y2xpcC1ydWxlOmV2ZW5vZGQ7fQoJLnN0MXtmaWxsOiNGRkZGRkY7fQo8L3N0eWxlPgo8ZyBpZD0iTGF5ZXJfeDAwMjBfMSI+Cgk8ZyBpZD0iXzIxODczODEzMjM4NTYiPgoJCTxyZWN0IHk9IjAiIGNsYXNzPSJzdDAiIHdpZHRoPSIyNTAwIiBoZWlnaHQ9IjI1MDAiPjwvcmVjdD4KCQk8Zz4KCQkJPHBhdGggY2xhc3M9InN0MSIgZD0iTTE0NjMsMTAxNWgtNDA0Yy0xNywwLTMxLDE0LTMxLDMxdjQwNGMwLDE3LDE0LDMxLDMxLDMxaDQwNGMxNywwLDMxLTE0LDMxLTMxdi00MDQgICAgIEMxNDk0LDEwMjksMTQ4MCwxMDE1LDE0NjMsMTAxNXoiPjwvcGF0aD4KCQkJPHBhdGggY2xhc3M9InN0MSIgZD0iTTk5Niw1NDlINTkyYy0xNywwLTMxLDE0LTMxLDMxdjQwNGMwLDE3LDE0LDMxLDMxLDMxaDQwNGMxNywwLDMxLTE0LDMxLTMxVjU4MEMxMDI3LDU2MywxMDEzLDU0OSw5OTYsNTQ5eiI+PC9wYXRoPgoJCQk8cGF0aCBjbGFzcz0ic3QxIiBkPSJNMTkzMCw1NDloLTQwNGMtMTcsMC0zMSwxNC0zMSwzMXY0MDRjMCwxNywxNCwzMSwzMSwzMWg0MDRjMTcsMCwzMS0xNCwzMS0zMVY1ODAgICAgIEMxOTYxLDU2MywxOTQ3LDU0OSwxOTMwLDU0OXoiPjwvcGF0aD4KCQkJPHBhdGggY2xhc3M9InN0MSIgZD0iTTk5NiwxNDgySDU5MmMtMTcsMC0zMSwxNC0zMSwzMXY0MDRjMCwxNywxNCwzMSwzMSwzMWg0MDRjMTcsMCwzMS0xNCwzMS0zMXYtNDA0ICAgICBDMTAyNywxNDk2LDEwMTMsMTQ4Miw5OTYsMTQ4MnoiPjwvcGF0aD4KCQkJPHBhdGggY2xhc3M9InN0MSIgZD0iTTE5MzAsMTQ4MmgtNDA0Yy0xNywwLTMxLDE0LTMxLDMxdjQwNGMwLDE3LDE0LDMxLDMxLDMxaDQwNGMxNywwLDMxLTE0LDMxLTMxdi00MDQgICAgIEMxOTYxLDE0OTYsMTk0NywxNDgyLDE5MzAsMTQ4MnoiPjwvcGF0aD4KCQk8L2c+Cgk8L2c+CjwvZz4KPC9zdmc+Cg==" alt="OKX icon" width="24" height="24">' +
							'</span>' +
						'</span>' +
					'</button>' +
				'</li>':
				'') +
				'<li>' +
					'<button data-type="metamask">' +
						'<span>' +
							'MetaMask' +
							'<span>' +
								'<img src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbDpzcGFjZT0icHJlc2VydmUiIGlkPSJMYXllcl8xIiB4PSIwIiB5PSIwIiB2ZXJzaW9uPSIxLjEiIHZpZXdCb3g9IjAgMCAzMTguNiAzMTguNiI+CiAgPHN0eWxlPgogICAgLnN0MSwuc3Q2e2ZpbGw6I2U0NzYxYjtzdHJva2U6I2U0NzYxYjtzdHJva2UtbGluZWNhcDpyb3VuZDtzdHJva2UtbGluZWpvaW46cm91bmR9LnN0NntmaWxsOiNmNjg1MWI7c3Ryb2tlOiNmNjg1MWJ9CiAgPC9zdHlsZT4KICA8cGF0aCBmaWxsPSIjZTI3NjFiIiBzdHJva2U9IiNlMjc2MWIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgZD0ibTI3NC4xIDM1LjUtOTkuNSA3My45TDE5MyA2NS44eiIvPgogIDxwYXRoIGQ9Im00NC40IDM1LjUgOTguNyA3NC42LTE3LjUtNDQuM3ptMTkzLjkgMTcxLjMtMjYuNSA0MC42IDU2LjcgMTUuNiAxNi4zLTU1LjN6bS0yMDQuNC45TDUwLjEgMjYzbDU2LjctMTUuNi0yNi41LTQwLjZ6IiBjbGFzcz0ic3QxIi8+CiAgPHBhdGggZD0ibTEwMy42IDEzOC4yLTE1LjggMjMuOSA1Ni4zIDIuNS0yLTYwLjV6bTExMS4zIDAtMzktMzQuOC0xLjMgNjEuMiA1Ni4yLTIuNXpNMTA2LjggMjQ3LjRsMzMuOC0xNi41LTI5LjItMjIuOHptNzEuMS0xNi41IDMzLjkgMTYuNS00LjctMzkuM3oiIGNsYXNzPSJzdDEiLz4KICA8cGF0aCBmaWxsPSIjZDdjMWIzIiBzdHJva2U9IiNkN2MxYjMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgZD0ibTIxMS44IDI0Ny40LTMzLjktMTYuNSAyLjcgMjIuMS0uMyA5LjN6bS0xMDUgMCAzMS41IDE0LjktLjItOS4zIDIuNS0yMi4xeiIvPgogIDxwYXRoIGZpbGw9IiMyMzM0NDciIHN0cm9rZT0iIzIzMzQ0NyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBkPSJtMTM4LjggMTkzLjUtMjguMi04LjMgMTkuOS05LjF6bTQwLjkgMCA4LjMtMTcuNCAyMCA5LjF6Ii8+CiAgPHBhdGggZmlsbD0iI2NkNjExNiIgc3Ryb2tlPSIjY2Q2MTE2IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGQ9Im0xMDYuOCAyNDcuNCA0LjgtNDAuNi0zMS4zLjl6TTIwNyAyMDYuOGw0LjggNDAuNiAyNi41LTM5Ljd6bTIzLjgtNDQuNy01Ni4yIDIuNSA1LjIgMjguOSA4LjMtMTcuNCAyMCA5LjF6bS0xMjAuMiAyMy4xIDIwLTkuMSA4LjIgMTcuNCA1LjMtMjguOS01Ni4zLTIuNXoiLz4KICA8cGF0aCBmaWxsPSIjZTQ3NTFmIiBzdHJva2U9IiNlNDc1MWYiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgZD0ibTg3LjggMTYyLjEgMjMuNiA0Ni0uOC0yMi45em0xMjAuMyAyMy4xLTEgMjIuOSAyMy43LTQ2em0tNjQtMjAuNi01LjMgMjguOSA2LjYgMzQuMSAxLjUtNDQuOXptMzAuNSAwLTIuNyAxOCAxLjIgNDUgNi43LTM0LjF6Ii8+CiAgPHBhdGggZD0ibTE3OS44IDE5My41LTYuNyAzNC4xIDQuOCAzLjMgMjkuMi0yMi44IDEtMjIuOXptLTY5LjItOC4zLjggMjIuOSAyOS4yIDIyLjggNC44LTMuMy02LjYtMzQuMXoiIGNsYXNzPSJzdDYiLz4KICA8cGF0aCBmaWxsPSIjYzBhZDllIiBzdHJva2U9IiNjMGFkOWUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgZD0ibTE4MC4zIDI2Mi4zLjMtOS4zLTIuNS0yLjJoLTM3LjdsLTIuMyAyLjIuMiA5LjMtMzEuNS0xNC45IDExIDkgMjIuMyAxNS41aDM4LjNsMjIuNC0xNS41IDExLTl6Ii8+CiAgPHBhdGggZmlsbD0iIzE2MTYxNiIgc3Ryb2tlPSIjMTYxNjE2IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGQ9Im0xNzcuOSAyMzAuOS00LjgtMy4zaC0yNy43bC00LjggMy4zLTIuNSAyMi4xIDIuMy0yLjJoMzcuN2wyLjUgMi4yeiIvPgogIDxwYXRoIGZpbGw9IiM3NjNkMTYiIHN0cm9rZT0iIzc2M2QxNiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBkPSJtMjc4LjMgMTE0LjIgOC41LTQwLjgtMTIuNy0zNy45LTk2LjIgNzEuNCAzNyAzMS4zIDUyLjMgMTUuMyAxMS42LTEzLjUtNS0zLjYgOC03LjMtNi4yLTQuOCA4LTYuMXpNMzEuOCA3My40bDguNSA0MC44LTUuNCA0IDggNi4xLTYuMSA0LjggOCA3LjMtNSAzLjYgMTEuNSAxMy41IDUyLjMtMTUuMyAzNy0zMS4zLTk2LjItNzEuNHoiLz4KICA8cGF0aCBkPSJtMjY3LjIgMTUzLjUtNTIuMy0xNS4zIDE1LjkgMjMuOS0yMy43IDQ2IDMxLjItLjRoNDYuNXptLTE2My42LTE1LjMtNTIuMyAxNS4zLTE3LjQgNTQuMmg0Ni40bDMxLjEuNC0yMy42LTQ2em03MSAyNi40IDMuMy01Ny43IDE1LjItNDEuMWgtNjcuNWwxNSA0MS4xIDMuNSA1Ny43IDEuMiAxOC4yLjEgNDQuOGgyNy43bC4yLTQ0Ljh6IiBjbGFzcz0ic3Q2Ii8+Cjwvc3ZnPg==" alt="MetaMask icon" width="24" height="24">' +
							'</span>' +
						'</span>' +
					'</button>' +
				'</li>' +
				'<li>' +
					'<button data-type="coinbase">' +
						'<span>' +
							'Coinbase' +
							'<span>' +
								'<img src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxuczp4b2RtPSJodHRwOi8vd3d3LmNvcmVsLmNvbS9jb3JlbGRyYXcvb2RtLzIwMDMiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHZlcnNpb249IjEuMSIgaWQ9IkxheWVyXzEiIHg9IjBweCIgeT0iMHB4IiB2aWV3Qm94PSIwIDAgMjUwMCAyNTAwIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCAyNTAwIDI1MDA7IiB4bWw6c3BhY2U9InByZXNlcnZlIj4KPHN0eWxlIHR5cGU9InRleHQvY3NzIj4KCS5zdDB7ZmlsbDpub25lO30KCS5zdDF7ZmlsbDojRkZGRkZGO30KCS5zdDJ7ZmlsbDojMDA1MkZGO30KPC9zdHlsZT4KPGcgaWQ9IkxheWVyX3gwMDIwXzEiPgoJPHJlY3QgeT0iMCIgY2xhc3M9InN0MCIgd2lkdGg9IjI1MDAiIGhlaWdodD0iMjUwMCI+PC9yZWN0PgoJPGcgaWQ9Il8xNTU2OTUxNjc1NjE2Ij4KCQk8ZyBpZD0iTGF5ZXJfeDAwMjBfMV8wIj4KCQkJPHJlY3QgeT0iMCIgY2xhc3M9InN0MCIgd2lkdGg9IjI1MDAiIGhlaWdodD0iMjUwMCI+PC9yZWN0PgoJCQk8ZyBpZD0iXzE4NDIxMzc1Mzc2OTYiPgoJCQkJPHBhdGggY2xhc3M9InN0MSIgZD0iTTEyNTAsMEwxMjUwLDBjNjkwLjIsMCwxMjUwLDU1OS44LDEyNTAsMTI1MGwwLDBjMCw2OTAuMi01NTkuOCwxMjUwLTEyNTAsMTI1MGwwLDAgICAgICBDNTU5LjgsMjUwMCwwLDE5NDAuMiwwLDEyNTBsMCwwQzAsNTU5LjgsNTU5LjgsMCwxMjUwLDB6Ij48L3BhdGg+CgkJCQk8cGF0aCBjbGFzcz0ic3QyIiBkPSJNMTI1MC40LDE2ODkuNWMtMjQyLjgsMC00MzkuNC0xOTYuNy00MzkuNC00MzkuNXMxOTYuNy00MzkuNCw0MzkuNC00MzkuNGMyMTcuNSwwLDM5OC4xLDE1OC42LDQzMi45LDM2Ni4yICAgICAgSDIxMjZjLTM3LjQtNDUxLjItNDE0LjktODA1LjctODc1LjYtODA1LjdjLTQ4NS4yLDAtODc4LjksMzkzLjctODc4LjksODc4LjlzMzkzLjcsODc4LjksODc4LjksODc4LjkgICAgICBjNDYwLjcsMCw4MzguMy0zNTQuNSw4NzUuNi04MDUuN2gtNDQzLjFDMTY0OC4xLDE1MzAuOSwxNDY3LjksMTY4OS41LDEyNTAuNCwxNjg5LjVMMTI1MC40LDE2ODkuNXoiPjwvcGF0aD4KCQkJPC9nPgoJCTwvZz4KCTwvZz4KPC9nPgo8L3N2Zz4K" alt="Coinbase icon" width="24" height="24">' +
							'</span>' +
						'</span>' +
					'</button>' +
				'</li>' +
				'<li>' +
					'<button data-type="phantom">' +
						'<span>' +
							'Phantom' +
							'<span>' +
								'<img src="data:image/svg+xml;base64,PHN2ZyBmaWxsPSJub25lIiBoZWlnaHQ9IjM0IiB3aWR0aD0iMzQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGxpbmVhckdyYWRpZW50IGlkPSJhIiB4MT0iLjUiIHgyPSIuNSIgeTE9IjAiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiM1MzRiYjEiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiM1NTFiZjkiLz48L2xpbmVhckdyYWRpZW50PjxsaW5lYXJHcmFkaWVudCBpZD0iYiIgeDE9Ii41IiB4Mj0iLjUiIHkxPSIwIiB5Mj0iMSI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjZmZmIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjZmZmIiBzdG9wLW9wYWNpdHk9Ii44MiIvPjwvbGluZWFyR3JhZGllbnQ+PGNpcmNsZSBjeD0iMTciIGN5PSIxNyIgZmlsbD0idXJsKCNhKSIgcj0iMTciLz48cGF0aCBkPSJtMjkuMTcwMiAxNy4yMDcxaC0yLjk5NjljMC02LjEwNzQtNC45NjgzLTExLjA1ODE3LTExLjA5NzUtMTEuMDU4MTctNi4wNTMyNSAwLTEwLjk3NDYzIDQuODI5NTctMTEuMDk1MDggMTAuODMyMzctLjEyNDYxIDYuMjA1IDUuNzE3NTIgMTEuNTkzMiAxMS45NDUzOCAxMS41OTMyaC43ODM0YzUuNDkwNiAwIDEyLjg0OTctNC4yODI5IDEzLjk5OTUtOS41MDEzLjIxMjMtLjk2MTktLjU1MDItMS44NjYxLTEuNTM4OC0xLjg2NjF6bS0xOC41NDc5LjI3MjFjMCAuODE2Ny0uNjcwMzggMS40ODQ3LTEuNDkwMDEgMS40ODQ3LS44MTk2NCAwLTEuNDg5OTgtLjY2ODMtMS40ODk5OC0xLjQ4NDd2LTIuNDAxOWMwLS44MTY3LjY3MDM0LTEuNDg0NyAxLjQ4OTk4LTEuNDg0Ny44MTk2MyAwIDEuNDkwMDEuNjY4IDEuNDkwMDEgMS40ODQ3em01LjE3MzggMGMwIC44MTY3LS42NzAzIDEuNDg0Ny0xLjQ4OTkgMS40ODQ3LS44MTk3IDAtMS40OS0uNjY4My0xLjQ5LTEuNDg0N3YtMi40MDE5YzAtLjgxNjcuNjcwNi0xLjQ4NDcgMS40OS0xLjQ4NDcuODE5NiAwIDEuNDg5OS42NjggMS40ODk5IDEuNDg0N3oiIGZpbGw9InVybCgjYikiLz48L3N2Zz4K" alt="Phantom icon" width="24" height="24">' +
							'</span>' +
						'</span>' +
					'</button>' +
				'</li>' +
				(typeof(okxwallet) == 'undefined'?
				'<li>' +
					'<button data-type="okx">' +
						'<span>' +
							'OKX' +
							'<span>' +
								'<img src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxuczp4b2RtPSJodHRwOi8vd3d3LmNvcmVsLmNvbS9jb3JlbGRyYXcvb2RtLzIwMDMiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHZlcnNpb249IjEuMSIgaWQ9IkxheWVyXzEiIHg9IjBweCIgeT0iMHB4IiB2aWV3Qm94PSIwIDAgMjUwMCAyNTAwIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCAyNTAwIDI1MDA7IiB4bWw6c3BhY2U9InByZXNlcnZlIj4KPHN0eWxlIHR5cGU9InRleHQvY3NzIj4KCS5zdDB7ZmlsbC1ydWxlOmV2ZW5vZGQ7Y2xpcC1ydWxlOmV2ZW5vZGQ7fQoJLnN0MXtmaWxsOiNGRkZGRkY7fQo8L3N0eWxlPgo8ZyBpZD0iTGF5ZXJfeDAwMjBfMSI+Cgk8ZyBpZD0iXzIxODczODEzMjM4NTYiPgoJCTxyZWN0IHk9IjAiIGNsYXNzPSJzdDAiIHdpZHRoPSIyNTAwIiBoZWlnaHQ9IjI1MDAiPjwvcmVjdD4KCQk8Zz4KCQkJPHBhdGggY2xhc3M9InN0MSIgZD0iTTE0NjMsMTAxNWgtNDA0Yy0xNywwLTMxLDE0LTMxLDMxdjQwNGMwLDE3LDE0LDMxLDMxLDMxaDQwNGMxNywwLDMxLTE0LDMxLTMxdi00MDQgICAgIEMxNDk0LDEwMjksMTQ4MCwxMDE1LDE0NjMsMTAxNXoiPjwvcGF0aD4KCQkJPHBhdGggY2xhc3M9InN0MSIgZD0iTTk5Niw1NDlINTkyYy0xNywwLTMxLDE0LTMxLDMxdjQwNGMwLDE3LDE0LDMxLDMxLDMxaDQwNGMxNywwLDMxLTE0LDMxLTMxVjU4MEMxMDI3LDU2MywxMDEzLDU0OSw5OTYsNTQ5eiI+PC9wYXRoPgoJCQk8cGF0aCBjbGFzcz0ic3QxIiBkPSJNMTkzMCw1NDloLTQwNGMtMTcsMC0zMSwxNC0zMSwzMXY0MDRjMCwxNywxNCwzMSwzMSwzMWg0MDRjMTcsMCwzMS0xNCwzMS0zMVY1ODAgICAgIEMxOTYxLDU2MywxOTQ3LDU0OSwxOTMwLDU0OXoiPjwvcGF0aD4KCQkJPHBhdGggY2xhc3M9InN0MSIgZD0iTTk5NiwxNDgySDU5MmMtMTcsMC0zMSwxNC0zMSwzMXY0MDRjMCwxNywxNCwzMSwzMSwzMWg0MDRjMTcsMCwzMS0xNCwzMS0zMXYtNDA0ICAgICBDMTAyNywxNDk2LDEwMTMsMTQ4Miw5OTYsMTQ4MnoiPjwvcGF0aD4KCQkJPHBhdGggY2xhc3M9InN0MSIgZD0iTTE5MzAsMTQ4MmgtNDA0Yy0xNywwLTMxLDE0LTMxLDMxdjQwNGMwLDE3LDE0LDMxLDMxLDMxaDQwNGMxNywwLDMxLTE0LDMxLTMxdi00MDQgICAgIEMxOTYxLDE0OTYsMTk0NywxNDgyLDE5MzAsMTQ4MnoiPjwvcGF0aD4KCQk8L2c+Cgk8L2c+CjwvZz4KPC9zdmc+Cg==" alt="OKX icon" width="24" height="24">' +
							'</span>' +
						'</span>' +
					'</button>' +
				'</li>':
				'') +
				(providerETH && providerETH.selectedAddress?
				'<li>' +
					'<button>' +
						'Disconnect' +
					'</button>' +
				'</li>':'') +
				'</ul>');

		$dialog.find('.dialog-content button').click(function() {
			let $this = $(this);
			let adapterType = $this.data('type');

			let connect = function() {
				try {
					if (adapterType) {
						if (adapterType != 'okx' && typeof(okxwallet) != 'undefined')
							alert('Please disabled your OKX wallet first and reload.');
						else
							tryETHWallet(adapterType, walletETHConnected, walletETHConnected)

					} else if (!adapterType) {
						if (providerETH && providerETH.disconnect)
							providerETH.disconnect();

						if (providerETH && providerETH.emit)
							providerETH.emit('disconnect');
					}

				} catch(e) {
					alert(e.message, 'error');
				}
			}

			$dialog.find('.dialog-title button').click();

			setTimeout(function() {
				connect();
			}, 300);
		});
	}

	var walletConnected = function() {
		if (!provider || !providerETH) {
			$connectSOL.removeAttr('data-address');
			$connectSOL.text('Select SOL Wallet');

			$claim.closest('li').addClass('disabled');
			return;
		}

		var wallet = provider.publicKey.toBase58();
		var short = wallet.substring(0, 4)+'...'+wallet.substring(wallet.length-4);

		$connectSOL.attr('data-address', wallet);
		$connectSOL.text(short);

		$claim.closest('li').removeClass('disabled');
	}

	var sagaWalletConnected = function() {
		if (!conf) {
			sagaFetchConf();

		} else if (provider && provider.publicKey && typeof(conf[bin2hex(provider.publicKey.toBytes())]) != 'undefined') {
			alert('Congratulations! You\'ve already claimed your LFGs!', 'info', true);

		} else if (provider && confSuspended) {
			alert('Unfortunately claims have been suspended!', 'info', true);
		}

		if (!provider) {
			$saga_connectSOL.removeAttr('data-address');
			$saga_connectSOL.text('Select SOL Wallet');

			$saga_claim.closest('li').addClass('disabled');
			sagaNft = undefined;
			nfts = false;
			return;
		}

		var wallet = provider.publicKey.toBase58();
		var short = wallet.substring(0, 4)+'...'+wallet.substring(wallet.length-4);

		if (conf && conf !== true && ((!nfts || $saga_connectSOL.attr('data-address') != wallet) && 
			typeof(conf[bin2hex(provider.publicKey.toBytes())]) == 'undefined'))
		{
			sagaFetchNfts();
		}

		$saga_connectSOL.attr('data-address', wallet);
		$saga_connectSOL.text(short);

		if (!conf || conf === true || confSuspended || !sagaNft ||
			typeof(conf[bin2hex(provider.publicKey.toBytes())]) != 'undefined')
		{
			$saga_claim.closest('li').addClass('disabled');

			if (sagaNft === false)
				alert('Unfortunately the selected wallet does not hold a Saga NFT.', 'info', true);

			return;
		}

		$saga_claim.text('Claim '+hrNumber(confAmount)+' LFG');
		$saga_claim.closest('li').removeClass('disabled');

		alert('Congratulations! Your Wallet is eligible to claim '+hrNumber(confAmount)+' LFG !', 'info', true);
	}

	var walletETHConnected = function() {
		if (!conf) {
			fetchConf();

		} else if (providerETH && providerETH.selectedAddress && typeof(conf[providerETH.selectedAddress.toLowerCase()]) != 'undefined') {
			$claim.text('Claim '+hrNumber(conf[providerETH.selectedAddress.toLowerCase()])+' LFG');

			if (confCustomAmounts)
				$claim_amount.show().find('input').val(conf[providerETH.selectedAddress.toLowerCase()]);

			if (!$('#alert').length) {
				if (conf[providerETH.selectedAddress.toLowerCase()] > 0 && !confSuspended) {
					alert('Congratulations! Your ETH Wallet is eligible to claim ' +
						hrNumber(conf[providerETH.selectedAddress.toLowerCase()])+' LFG !', 'info', true);
				} else if (confSuspended) {
					alert('Unfortunately claims have ended! Stay tuned for other ways to participate.', 'info', true);
				} else {
					alert('Congratulations! You\'ve already claimed your LFGs!', 'info', true);
				}
			}

		} else {
			$claim.text('Claim Your LFG');

			if (confCustomAmounts)
				$claim_amount.hide().find('input').val('');

			if (providerETH && providerETH.selectedAddress && conf && conf !== true) {
				if (confSuspended)
					alert('Unfortunately claims have ended! Stay tuned for other ways to participate.', 'info', true);
				else
					alert('Unfortunately the selected ETH wallet is not eligible to claim any LFG yet.', 'info', true);
			}
		}

		if (!providerETH || !providerETH.selectedAddress) {
			$connectETH.removeAttr('data-address');
			$connectETH.text('Select ETH Wallet');

			$connectSOL.closest('li').addClass('disabled');
			$claim.closest('li').addClass('disabled');
			return;
		}

		var wallet = providerETH.selectedAddress;
		var short = wallet.substring(0, 6)+'...'+wallet.substring(wallet.length-4);

		$connectETH.attr('data-address', wallet);
		$connectETH.text(short);

		if (typeof(conf[providerETH.selectedAddress.toLowerCase()]) != 'undefined' && conf[providerETH.selectedAddress.toLowerCase()] > 0 && !confSuspended)
			$connectSOL.closest('li').removeClass('disabled');

		if (spentStats.wallet != wallet) {
			spentStats.wallet = wallet;

			$.ajax({
				url: 'https://api.lessfeesandgas.org/airdrop?address='+providerETH.selectedAddress,
				complete: function(xhr) {
					var json;
					try {
						json = JSON.parse(xhr.responseText);
					} catch(e){console.log(e);};

					if (!json || !json.address) {
						spentStats.SpentEth = undefined;
						spentStats.SpentUsd = undefined;

						console.log(xhr);
						return;
					}

					spentStats.SpentEth = json.SpentEth;
					spentStats.SpentUsd = json.SpentUsd;
				}
			});
		}
	}

	var fireConfetti = function() {
		var count = 200;
		var defaults = {
		  zIndex: 1301,
		  origin: { y: 0.5 },
		  scalar: 2.5
		};

		function fire(particleRatio, opts) {
		  confetti({
		    ...defaults,
		    ...opts,
		    particleCount: Math.floor(count * particleRatio)
		  });
		}

		fire(0.25, {
		  spread: 126,
		  startVelocity: 55,
		});
		fire(0.2, {
		  spread: 160,
		});
		fire(0.35, {
		  spread: 100,
		  decay: 0.91,
		  scalar: 0.8
		});
		fire(0.1, {
		  spread: 120,
		  startVelocity: 25,
		  decay: 0.92,
		  scalar: 1.2
		});
		fire(0.1, {
		  spread: 120,
		  startVelocity: 45,
		});
	}

	var loader = function(show, text) {
		if (show) {
			$loader.children('p').remove();

			if (text)
				$loader.append('<p>'+text+'</p>');

			$loader.show();
			setTimeout(function() { $loader.removeClass('hidden'); }, 1);

		} else {
			$loader.addClass('hidden');
			setTimeout(function() { $loader.hide(); $loader.children('p').remove(); }, 500);
		}
	}

	$claim.click(function() {
		if (this.disabled)
			return false;

		if (!$connectETH.attr('data-address')) {
			alert('No ETH Wallet selected.', 'error');
			return false;
		}

		if (!$connectSOL.attr('data-address')) {
			alert('No SOL Wallet selected.', 'error');
			return false;
		}

		transactions.claim($connectETH.attr('data-address'), $connectSOL.attr('data-address'));
		return false;
	});

	$saga_claim.click(function() {
		if (this.disabled)
			return false;

		if (!$saga_connectSOL.attr('data-address')) {
			alert('No SOL Wallet selected.', 'error');
			return false;
		}

		transactions.sagaClaim($saga_connectSOL.attr('data-address'));
		return false;
	});

	$claim_amount.find('input').on('keyup change', function() {
		var amount = parseInt(this.value);

		if (amount <= 0 || isNaN(amount)) {
			if (providerETH && providerETH.selectedAddress && typeof(conf[providerETH.selectedAddress.toLowerCase()]) != 'undefined')
				amount = conf[providerETH.selectedAddress.toLowerCase()];
			else
				amount = 'ALL';
		}

		$claim.text('Claim '+hrNumber(amount)+' LFG');
	}).keydown(function(e) {
		var key = e.charCode || e.keyCode || 0;
		// allow backspace, tab, delete, enter, arrows, numbers and keypad numbers ONLY
		// home, end, period, and numpad decimal
		return (
			key == 8 || 
			key == 9 ||
			key == 13 ||
			key == 46 ||
			key == 110 ||
			key == 190 ||
			(key >= 35 && key <= 40) ||
			(key >= 48 && key <= 57) ||
			(key >= 96 && key <= 105));
	});

	$connectETH.click(function() {
		pickETH();
		return false;
	});

	$connectSOL.add($saga_connectSOL).click(function() {
		pick();
		return false;
	});

	$('.head button, .foot button').click(function() {
		if (this.id == "bridge") {
			$dialog = dialog('LFG Bridge', '<div id="mayan_widget"></div>');
			const config = {
				appIdentity: {
					name: 'LessFnGas',
					icon: 'static/images/logo.svg',
					uri: window.location,
				},
				rpcs: {
					solana: rpc,
				},
				tokens: {
					to: {
						solana: [
							'0x0000000000000000000000000000000000000000',
							'LFG1ezantSY2LPX8jRz2qa31pPEhpwN9msFDzZw4T9Q'
						],
					}
				},
				destinationChains: ['solana'],
			}

			MayanSwap.init('mayan_widget', config);
			return;
		}

		var $dialog = $('#saga_claim_dialog');
		$dialog.show();

		$dialog.find('.dialog-title button').click(function() { 
			$dialog.find('.dialog-backdrop').css('opacity', 0);
			$dialog.find('.dialog-paper').addClass('out');

			setTimeout(function() {
				$dialog.hide();
				$dialog.find('.dialog-paper').removeClass('out').addClass('in');
			}, 500);

			alert(false);
		});

		setTimeout(function() {
			$dialog.find('.dialog-backdrop').css('opacity', 1);
			$dialog.find('.dialog-paper').removeClass('in');
		}, 100);

		/*var $dialog = $('#claim_dialog');
		$dialog.show();

		$dialog.find('.dialog-title button').click(function() { 
			$dialog.find('.dialog-backdrop').css('opacity', 0);
			$dialog.find('.dialog-paper').addClass('out');

			setTimeout(function() {
				$dialog.hide();
				$dialog.find('.dialog-paper').removeClass('out').addClass('in');
			}, 500);

			alert(false);
		});

		setTimeout(function() {
			$dialog.find('.dialog-backdrop').css('opacity', 1);
			$dialog.find('.dialog-paper').removeClass('in');
		}, 100);*/
	});

	$('.content .card.img img').each(function () {
		let $content = $(this).closest('.content');

		let showContent = function() {
			setTimeout(function() {
				loader(false);
				$content.removeAttr('style').addClass('show');
			}, 100);
		}

		metaImage = new Image();
		metaImage.src = $('meta[property="og:image"]').attr('content');

		var objImage = new Image();
		objImage.src = this.src;

		if (objImage.complete || (objImage.height && objImage.height > 0)) {
			showContent();
		} else {
			objImage.onload = showContent;
			objImage.onerror = showContent;
		}
	});

	init();
});