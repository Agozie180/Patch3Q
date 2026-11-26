// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Patch3QRegistryV5} from "../Patch3QRegistryV5.sol";

contract Patch3QRegistryV5Harness is Patch3QRegistryV5 {
    mapping(address account => bytes pubkey) private testPqKeys;
    mapping(bytes32 pubkeyHash => bool valid) private testPqKeyValidity;
    bool public testPqSignatureValid = true;
    bool public useKeySpecificValidity;

    constructor(address trustedBountyToken) Patch3QRegistryV5(trustedBountyToken) {}

    function setPqKey(address account, bytes calldata pubkey) external {
        testPqKeys[account] = pubkey;
    }

    function setPqSignatureValid(bool valid) external {
        testPqSignatureValid = valid;
        useKeySpecificValidity = false;
    }

    function setPqKeySignatureValid(bytes calldata pubkey, bool valid) external {
        testPqKeyValidity[keccak256(pubkey)] = valid;
        useKeySpecificValidity = true;
    }

    function _registeredPqKey(address account) internal view override returns (bytes memory pubkey) {
        pubkey = testPqKeys[account];
        require(pubkey.length != 0, "test PQ key missing");
    }

    function _verifyPq(bytes memory pubkey, bytes calldata, bytes memory)
        internal view override returns (bool)
    {
        return useKeySpecificValidity ? testPqKeyValidity[keccak256(pubkey)] : testPqSignatureValid;
    }
}
