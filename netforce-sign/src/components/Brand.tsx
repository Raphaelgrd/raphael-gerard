import { useState } from 'react';

/** Logo officiel (public/logo.png) ; repli sur le nom en texte tant que le fichier est absent. */
export default function Brand() {
  const [failed, setFailed] = useState(false);
  return (
    <div className="brand">
      {failed ? (
        <span className="logo">NETFORCE</span>
      ) : (
        <img className="logo-img" src="logo.png" alt="NETFORCE" onError={() => setFailed(true)} />
      )}
    </div>
  );
}
