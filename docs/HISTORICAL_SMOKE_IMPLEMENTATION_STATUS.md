# Historical smoke implementation status

This branch adds a credential-free test harness for the manual TxLINE historical smoke command.

Automated checks cover endpoint construction, the documented replay window, official schema-compatible normalization, exact cursor isolation, and receipt allowlisting. CI does not contact TxLINE and does not claim that the real manual run has occurred.

A public verification badge remains blocked until a human completes the authenticated local run and reviews the generated private receipt.
